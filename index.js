const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 7071 });

const connections = new Map();
let players = new Map();
let all_players = [];
let alive_players = [];
let ball = {};
let queue_players = [];

let count_user = 0;
let is_game_start = false;
let is_enough_player_to_play = false;
let next_player_target_id = "";

function parseJson(str) {
    let data;
    try {
        data = JSON.parse(str);
    }
    catch (e) {
        data = str;
    }
    return data;
}

function parseString(obj) {
    let data;
    try {
        data = JSON.stringify(obj);
    }
    catch (e) {
        data = obj;
    }
    return data;
}

function generateUniqueId() {
    return 'xxxxxxxx'.replace(/[x]/g, function (c) {
        var r = Math.random() * 26 | 0;
        return String.fromCharCode(97 + r); // ASCII code for 'a' is 97
    });
}

function handleCreateNewWSConnection(ws) {
    const id = generateUniqueId();
    let data = { ws, id };
    connections.set(ws, data);
    players.set(id, data);

    let msg = { action: "create_new_player", data: { player: { id } } };
    ws.send(JSON.stringify(msg));
}

function handleCloseWS(ws) {
    const connectionData = connections.get(ws);
    connections.delete(ws);
    players.delete(connectionData.id);
    count_user--;
    console.log(count_user)
}

function get_random_player_id() {
    let player_ids = Array.from(players.keys());
    player_ids = player_ids.filter(id => alive_players.includes(id));
    return player_ids[Math.floor(Math.random() * player_ids.length)];
}

function move_ball(position) {
    ball.position = position;
    broadcast({ action: "move_ball", data: { ball: { position }, player: { id: next_player_target_id } } });
}

function player_click(msg) {
    if (alive_players.includes(msg.data.player.id) && next_player_target_id != msg.data.player.id) {
        const player = players.get(msg.data.player.id);
        player.position = msg.data.player.position;
        broadcast({ action: "player_click", data: msg.data });
    }
}

function handleMsg(ws, data) {
    let msg = parseJson(data);

    if (msg.action == "set_player_name") {
        const player = players.get(msg.data.player.id);
        player.name = msg.data.player.name;
        console.log(`Player ${player.name} connect to server`);
        if (!is_game_start) {
            count_user++;
            console.log(count_user)
        }

    }
    else if (msg.action == "player_click") {
        player_click(msg);
    }
    else if (msg.action == "player_hit_ball") {
        move_ball();
    }
}

wss.on('connection', (ws) => {

    handleCreateNewWSConnection(ws);

    ws.on("message", (msg) => {
        handleMsg(ws, msg);
    });

    ws.on('close', () => {
        handleCloseWS(ws);
    });

    ws.on('error', () => {
        handleCloseWS(ws);
    });
});

function sendMsg(id, msg) {
    const data = players.get(id);
    if (data && data.ws.readyState === WebSocket.OPEN) {
        data.ws.send(parseString(msg));
    }
}

function broadcast(msg) {
    connections.forEach((_, ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(parseString(msg));
        }
    });
}

function summon_ball(position) {
    broadcast({
        action: "summon_ball", data: {
            ball: { position }
        }
    });
}

function summon_player(id, position) {
    const player = players.get(id);
    alive_players.push(id);
    all_players.push(id);
    player.position = position;
    console.log("Summon player: ", player.name);
    broadcast({ action: "summon_player", data: { player: { id, position, name: player.name } } });
}

function summon_all_player() {
    let radius = 20;
    let ids = [...players.keys()];
    for (let i = 0; i < count_user; i++) {
        const angle = (360 / count_user) * i;
        const x = 50 + radius * Math.cos((angle * Math.PI) / 180);
        const y = 50 + radius * Math.sin((angle * Math.PI) / 180);
        summon_player(ids[i], { x, y });
    }
}

function reset_game() {
    next_player_target_id = "";
    alive_players = all_players;
    reset_step = true;
}

function loading_game() {

    let countdown_until_game_start_time = 3;
    let countdown_until_game_start_interval = setInterval(() => {

        console.log(`Game will start in ${countdown_until_game_start_time}`)
        broadcast({ action: "label_no_entity", data: { name: "countdown_until_game_start", time: countdown_until_game_start_time } });

        countdown_until_game_start_time--;

        if (countdown_until_game_start_time < 0) {

            reset_game();

            console.log('Start game');
            broadcast({ action: "game_start" });

            summon_all_player();
            ball.position = { x: 50, y: 50 };
            summon_ball(ball.position);

            is_game_start = true;

            next_player_target_id = get_random_player_id();

            clearInterval(countdown_until_game_start_interval);
        }
    }, 1000);
}

setInterval(() => {
    if (count_user > 0) {
        if (!is_enough_player_to_play) {
            if (count_user > 1) {
                is_enough_player_to_play = true;
                console.log('Enough player to play');
                loading_game();
            }
            else {
                console.log("Waiting other player");
                broadcast({ action: "label_no_entity", data: { name: "waiting_other_player" } });
                is_game_start = false;
                reset_step = true;
                is_enough_player_to_play = false;
            }
        }
        else if (count_user < 2) {
            console.log("Not enough player in start game");
            is_enough_player_to_play = false;
        }
    }
}, 1000);

let start_step = 50;
let acceleration = 100;
let max_step = 1500;
let smooth_step = 5000;
let reset_step = false;

async function game_loop(time, step) {

    const currentTime = Date.now();
    const elapsedTime = currentTime - time;
    if (is_game_start) {

        if (reset_step) {
            step = start_step;
            reset_step = false;
        }

        try {
            const player = players.get(next_player_target_id);

            const dx = (player.position.x) - ball.position.x;
            const dy = (player.position.y) - ball.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            const normalizedDx = dx / distance;
            const normalizedDy = dy / distance;

            let x = ball.position.x + normalizedDx * step * (elapsedTime / smooth_step);
            let y = ball.position.y + normalizedDy * step * (elapsedTime / smooth_step);

            step = Math.min(step + step / acceleration, max_step);

            if (distance > 4.5) {
                move_ball({ x, y });
            }
            else {
                console.log(`Player ${player.name} got hit`);
                alive_players.pop(next_player_target_id);
                broadcast({ action: "ball_hit_player", data: { player: { id: next_player_target_id } } });

                if (alive_players.length > 1) {
                    next_player_target_id = get_random_player_id();
                }
                else {
                    let winner = players.get(alive_players[0]);
                    console.log(`Winner is ${winner.name}`);
                    broadcast({ action: "winner", data: { player: { name: winner.name } } });
                    is_game_start = false;

                    setTimeout(() => { loading_game() }, 5000);
                }
            }
        }
        catch (e) { }
    }
    setTimeout(() => game_loop(currentTime, step), 20);
}
game_loop(Date.now(), start_step);
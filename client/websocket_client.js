import settings from './settings.js';
import * as game from './game.js';
import * as ui from './ui.js';
import * as audio from './audio.js';

import Planet from './planet.js';
import Enemy from './enemy.js';
import Shot from './shot.js';
import Player from './player.js';

import { planets, enemies, shots, universe, deadShots, players } from './entities.js';
import message from '../shared/message.js';

let enabledTeams = [],
	masterSocket = new WebSocket('wss://' + location.hostname + (location.port === '' ? '' : ':' + location.port) + '/clients');

export let serverList;
export var currentConnection;

const HISTORY_MENU = 0,
	HISTORY_GAME = 1;

let {encodeLobbyNumber, decodeLobbyNumber} = (() => {
	const pChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&\'()*+,;=:@'; // https://tools.ietf.org/html/rfc3986#section-3.3
	function encodeLobbyNumber(lobbyNb) {
		let upperDigit = Math.trunc(lobbyNb/pChars.length),
			lobbyCode = pChars.charAt(lobbyNb%pChars.length);

		if (upperDigit === 0) return lobbyCode;
		else return encodeLobbyNumber(upperDigit) + lobbyCode;
	}
	function decodeLobbyNumber(lobbyCode) {
		let lobbyNb = 0;

		for (let i = 0; i !== lobbyCode.length; ++i) lobbyNb += Math.pow(pChars.length, lobbyCode.length - i -1) * pChars.indexOf(lobbyCode.charAt(i));

		return lobbyNb;
	}

	return {encodeLobbyNumber, decodeLobbyNumber};
})();

masterSocket.binaryType = 'arraybuffer';
masterSocket.addEventListener('message', msg => {
	switch (new Uint8Array(msg.data, 0, 1)[0]) {
		case message.ADD_SERVERS.value:
			console.log('Got some new servers to add ! :D');
			if (serverList === undefined) {//first time data is inserted
				serverList = message.ADD_SERVERS.deserialize(msg.data);
				serverList.forEach(ui.addServerRow);
				ui.applyLobbySearch();//in case the page was refreshed and the
			} else {
				let newServers = message.ADD_SERVERS.deserialize(msg.data);
				serverList = serverList.concat(newServers);
				newServers.forEach(ui.addServerRow);
			}
			break;
		case message.REMOVE_SERVERS.value:
			console.log('I hafta remove servers :c');
			for (let id of message.REMOVE_SERVERS.deserialize(msg.data)) {
				ui.removeServer(id);
			}
			break;
	}
});

class Connection {
	constructor(url, lobbyId) {// a connection to a game server
		this.lastControls = {};
		this.lastMessage;

		this.latencyHandler = setInterval(() => {
			if (game.state !== 'playing') return;
			let param1 = document.getElementById('gui-bad-connection');
			if (Date.now() - this.lastMessage > 2000) param1.classList.remove('hidden');
			else param1.classList.add('hidden');

			if (this.lastMessage !== undefined && Date.now() - this.lastMessage > 7000) {
				currentConnection.close();
				game.stop();
			}
		}, 100);

		return new Promise((resolve, reject) => {
			try {
				this.socket = new WebSocket(url);
			} catch (err) {
				reject(err);
				ui.showBlockedPortDialog(url.match(/:(\d+)/)[1]);
			}
			this.socket.binaryType = 'arraybuffer';
			this.socket.addEventListener('error', this.errorHandler);
			this.socket.addEventListener('message', this.messageHandler.bind(this));
			this.socket.addEventListener('open', () => {
				this.sendMessage.call(this, message.CONNECT, lobbyId, settings);
				resolve(this);
			});
		});
	}
	alive() {
		return this.socket.readyState === 1;
	}
	sendMessage(messageType, ...args) {
		try {
			this.socket.send(messageType.serialize.apply(messageType, args));
		} catch(err) {
			console.log(err);
			//TODO: display 'connection lost' and get back to the main menu
			//or is that redudant with the event listener on 'error'?
		}
	}
	createLobby(name, playerAmount) {
		this.socket.send(message.CREATE_LOBBY.serialize(name, playerAmount));
	}
	close() {
		clearInterval(this.latencyHandler);
		this.socket.close();
		this.socket.removeEventListener('error', this.errorHandler);
		this.socket.removeEventListener('message', this.messageHandler);
		game.stop();
		players.length = 0;
		document.getElementById('lobby-table').classList.remove('hidden');
		document.getElementById('player-table').classList.add('hidden');
		history.pushState(HISTORY_MENU, '', '/');
		let chatElement = document.getElementById('gui-chat');
		while (chatElement.childNodes.length > 1) chatElement.removeChild(chatElement.childNodes[1]);
	}
	setPreferences() {
		this.sendMessage(message.SET_PREFERENCES, settings);
	}
	sendChat(content) {
		this.sendMessage(message.CHAT, content);
		ui.printChatMessage(players[game.ownIdx].getFinalName(), players[game.ownIdx].appearance, content);
	}
	refreshControls(selfControls) {
		let accordance = 0, b = 0; //checking if every entry is the same, if so no changes & nothing to send
		for (let c in selfControls) {
			b++;
			if (this.lastControls[c] === selfControls[c]) accordance++;
			else this.lastControls[c] = selfControls[c];
		}
		if (accordance === b) return;
		this.socket.send(message.PLAYER_CONTROLS.serialize(selfControls));
	}
	sendMousePos(angle) {
		if (this.lastAngle === undefined) this.lastAngle = 0;
		if (this.lastAngle !== angle) this.sendMessage(message.AIM_ANGLE, angle);
		this.lastAngle = angle;
	}
	errorHandler() {
		//TODO: go back to main menu
		this.close();
	}
	messageHandler(msg) {
		this.lastMessage = Date.now();
		switch (new Uint8Array(msg.data, 0, 1)[0]) {
			case message.ERROR.value: {
				let errDesc;
				switch(message.ERROR.deserialize(msg.data)) {
					case message.ERROR.NO_LOBBY:
						errDesc = 'This lobby doesn\'t exist anymore';//TODO: show this message in a pop-up with 'See the other servers button' to get back to the menu
						break;
					case message.ERROR.NO_SLOT:
						errDesc = 'There\'s no slot left in the lobby';
						break;
				}
				location.hash = '';
				alert('Error:\n' + errDesc);
				break;
			}
			case message.CONNECT_ACCEPTED.value: {
				let val = message.CONNECT_ACCEPTED.deserialize(msg.data);
				planets.length = 0;
				enemies.length = 0;
				shots.length = 0;
				players.length = 0;

				game.setOwnIdx(val.playerId);
				console.log('gotten C_ACC', game.ownIdx);
				universe.width = val.univWidth;
				universe.height = val.univHeight;

				let hashSocket = this.socket.url.replace(/^ws(s)?\:\/\/(.+)(:?\/)$/, '$1$2');
				location.hash = '#srv=' + hashSocket + '&lobby=' + encodeLobbyNumber(val.lobbyId);

				document.getElementById('lobby-table').classList.add('hidden');
				document.getElementById('player-table').classList.remove('hidden');
				break;
			}
			case message.ADD_ENTITY.value:
				message.ADD_ENTITY.deserialize(msg.data,
					(x, y, radius, type) => {//add planets
						planets.push(new Planet(x, y, radius, type));
					},
					(x, y, appearance) => {//add enemies
						enemies.push(new Enemy(x, y, appearance));
					},
					(x, y, angle, origin, type) => {//add shots
						audio.laserModel.makeSound(audio.makePanner(x - players[game.ownIdx].box.center.x, y - players[game.ownIdx].box.center.y)).start(0);
						let shot = new Shot(x, y, angle, origin, type);
						shots.push(shot);
						let originatingPlayer = players.find(element => { return element !== undefined && element.pid === origin; });
						if (originatingPlayer) originatingPlayer.armedWeapon.muzzleFlash = type === shot.TYPES.BULLET || type === shot.TYPES.BALL;
					},
					(pid, x, y, attachedPlanet, angle, looksLeft, jetpack, appearance, walkFrame, name, homographId, armedWeapon, carriedWeapon) => {//add players
						let newPlayer = new Player(name, appearance, walkFrame, attachedPlanet, jetpack, undefined, undefined, armedWeapon, carriedWeapon);
						newPlayer.pid = pid;
						newPlayer.box.center.x = x;
						newPlayer.box.center.y = y;
						newPlayer.looksLeft = looksLeft;
						newPlayer.homographId = homographId;
						if (!(pid in players)) ui.printChatMessage(undefined, undefined, newPlayer.getFinalName() + ' joined the game');
						players[pid] = newPlayer;
					}
				);
				ui.updatePlayerList();
				break;
			case message.REMOVE_ENTITY.value:
				message.REMOVE_ENTITY.deserialize(msg.data,
					id => {//remove planets
						console.log('TODO: implement planet removal', id);
					},
					id => {//remove enemies
						console.log('TODO: implement enemy removal', id);
					},
					id => {//remove shots
						deadShots.push(shots[id]);
						deadShots[deadShots.length - 1].lifeTime = 0;
						shots.splice(id, 1);
					},
					id => {//remove players
						ui.printChatMessage(undefined, undefined, players[id].getFinalName() + ' has left the game');
						delete players[id];
					}
				);
				ui.updatePlayerList();
				break;
			case message.GAME_STATE.value: {
				let val = message.GAME_STATE.deserialize(msg.data, planets.length, enemies.length,
					(id, ownedBy, progress) => {
						planets[id].progress.team = ownedBy;
						planets[id].progress.value = progress;
						planets[id].updateColor();
					},
					(id, angle) => {
						enemies[id].box.angle = angle;
					},
					(pid, x, y, attachedPlanet, angle, looksLeft, jetpack, hurt, walkFrame, armedWeapon, carriedWeapon, aimAngle) => {
						console.log(armedWeapon, carriedWeapon, players, pid, game.ownIdx);
						if (pid === game.ownIdx) {
							if (!players[pid].jetpack && jetpack) {
								players[pid].jetpackSound = audio.jetpackModel.makeSound(audio.sfxGain, 1);
								players[pid].jetpackSound.start(0);
							} else if (players[pid].jetpack && !jetpack && players[game.ownIdx].jetpackSound !== undefined) {
								players[pid].jetpackSound.stop();
							}
						} else {
							if (players[pid] === undefined) console.log(players, pid); // this shouldn't happen
							if (!players[pid].jetpack && jetpack) {
								audio.setPanner(players[pid].panner, players[pid].box.center.x - players[game.ownIdx].box.center.x, players[pid].box.center.y - players[game.ownIdx].box.center.y);
								players[pid].jetpackSound = audio.jetpackModel.makeSound(players[pid].panner, 1);
								players[pid].jetpackSound.start(0);
							} else if(players[pid].jetpack && !jetpack && players[pid].jetpackSound !== undefined) {
								players[pid].jetpackSound.stop();
							}
						}
						let param1 = Date.now(), param2 = players[pid];

						if ('timestamp' in players[pid].predictionTarget) param1 = param2.predictionTarget.timestamp;
						players[pid].predictionTarget = {timestamp: Date.now(), box: new vinage.Rectangle(new vinage.Point(x, y), 0, 0, angle), aimAngle: aimAngle};
						players[pid].predictionBase = {timestamp: param1, box: new vinage.Rectangle(new vinage.Point(param2.box.center.x, param2.box.center.y), 0, 0, param2.box.angle), aimAngle: param2.aimAngle};
						players[pid].looksLeft = looksLeft;
						if ((players[pid].walkFrame === 'walk1' && walkFrame === 'walk2') || (players[pid].walkFrame === 'walk2' && walkFrame === 'walk1')) {
							let type = planets[players[pid].attachedPlanet].type,
								stepSound = audio.stepModels[type][players[pid].lastSound].makeSound(audio.makePanner(x - players[game.ownIdx].box.center.x, y - players[game.ownIdx].box.center.y));
							if (stepSound.buffer !== undefined) {
								stepSound.playbackRate.value = Math.random() + 0.5;//pitch is modified from 50% to 150%
							} else {//hack for Chrome (doesn't sound as good)
								stepSound.mediaElement.playbackRate = Math.random() + 0.5;
							}
							stepSound.start(0);
							players[pid].lastSound = (players[pid].lastSound + 1) % 5;
						}
						players[pid].walkFrame = walkFrame;
						players[pid].hurt = hurt;
						players[pid].jetpack = jetpack;

						players[pid].attachedPlanet = attachedPlanet;
						players[pid].armedWeapon = players[pid].weapons[armedWeapon];
						players[pid].carriedWeapon = players[pid].weapons[carriedWeapon];
					}
				);

				players[game.ownIdx].health = val.yourHealth;
				players[game.ownIdx].fuel = val.yourFuel;

				Array.prototype.forEach.call(document.querySelectorAll('#gui-health div'), (element, index) => {
					let state = 'heartFilled';
					if (index * 2 + 2 <= players[game.ownIdx].health) state = 'heartFilled';
					else if (index * 2 + 1 === players[game.ownIdx].health) state = 'heartHalfFilled';
					else state = 'heartNotFilled';
					element.className = state;
				});
				let fuelElement = document.getElementById('gui-fuel');
				if (fuelElement.value !== val.yourFuel) fuelElement.value = val.yourFuel;

				break;
			}
			case message.CHAT_BROADCAST.value: {
				let val = message.CHAT_BROADCAST.deserialize(msg.data);
				ui.printChatMessage(players[val.id].getFinalName(), players[val.id].appearance, val.message);
				break;
			}
			case message.SET_NAME_BROADCAST.value: {
				let val = message.SET_NAME_BROADCAST.deserialize(msg.data),
					oldName = players[val.id].getFinalName();
				players[val.id].name = val.name;
				players[val.id].homographId = val.homographId;
				ui.printChatMessage(undefined, undefined, '"' + oldName + '" is now known as "' + players[val.id].getFinalName() + '"');
				ui.printPlayerList();
				break;
			}
			case message.SCORES.value: {
				let val = message.SCORES.deserialize(msg.data, enabledTeams);
				console.log(val);
				game.setScores(val);
				for (let team in val) {
					let element = document.getElementById('gui-points-' + team);
					if (element !== null) element.textContent = val[team];
				}
				break;
			}
			case message.LOBBY_STATE.value: {
				let val = message.LOBBY_STATE.deserialize(msg.data);
				if (val.enabledTeams !== undefined) {
					enabledTeams = val.enabledTeams;
					let pointsElement = document.getElementById('gui-points');
					while (pointsElement.firstChild) pointsElement.removeChild(pointsElement.firstChild);
					for (let team of enabledTeams) {
						let teamItem = document.createElement('div');
						teamItem.id = 'gui-points-' + team;
						pointsElement.appendChild(teamItem);
					}
				}
				game.setState(val.state);

				let playerTableVictoryElement = document.getElementById('lobby-victory');
				playerTableVictoryElement.style.display = 'none';
				document.getElementById('lobby-status').textContent = val.state;
				if (val.state === 'warmup') {
					document.getElementById('gui-warmup').classList.remove('hidden');
					game.start();
				} else if (val.state === 'playing') {
					document.getElementById('gui-warmup').classList.add('hidden');
					game.start();
				} else if (val.state === 'displaying_scores') {
					let victor = null,
						a = -Infinity;
					playerTableVictoryElement.style.display = 'initial';
					for (let team in game.scores) {
						if (game.scores[team] > a) {
							a = game.scores[team];
							victor = team;
						} else if (game.scores[team] === a) victor = null;
					}
					playerTableVictoryElement.textContent = !victor ? 'Tied!' : victor + ' won!';
					game.stop();
				}
				break;
			}
		}
	}
}

export function makeNewCurrentConnection(url, id) {
	new Connection(url, id).then((connection) => {
		currentConnection = connection;
		ui.closeMenu(universe);
	}).catch((err) => {
		console.error(err);
	});
}

function connectByHash() {
	if (location.hash === '') return;
	try {
		let [, ip, lobbyId] = location.hash.match(/^#srv=(s?[\d\.:a-f]*)&lobby=([ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789\-\._~!$&'()\*\+,;=:@]+)/),
			protocol;
		lobbyId = decodeLobbyNumber(lobbyId);

		if (ip.startsWith('s')) {
			protocol = 'ws://';
			ip = ip.slice(1);
		} else protocol = 'wss://';

		let url = protocol + ip + '/';

		if (currentConnection !== undefined) {
			if (currentConnection.socket.url !== url) {
				currentConnection.close();
				currentConnection = makeNewCurrentConnection(url, lobbyId);
			} else if (!currentConnection.alive()) {
				currentConnection = makeNewCurrentConnection(url, lobbyId);
			}
		} else currentConnection = makeNewCurrentConnection(url, lobbyId);
	} catch (ex) {
		if (currentConnection !== undefined) currentConnection.close();
		console.log(ex, ex.stack);
	}
}

export function handleHistoryState() {
	//modifies default history entries due hash changes
	if (location.hash !== '') history.replaceState(HISTORY_GAME, '', '/' + location.hash);
	else history.replaceState(HISTORY_MENU, '', '/');
	if (history.state === HISTORY_MENU) {
		//if navigated to / stop the game + display menu
		if (currentConnection !== undefined) currentConnection.close();
		game.stop();
	} else if (history.state === HISTORY_GAME) connectByHash();
}
window.addEventListener('popstate', handleHistoryState);


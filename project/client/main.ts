import './style.css';
import { appLayout } from './layout.js';
import { catalogMarkup } from './catalog.js';
import { ARENAS, CHARACTERS, DEFAULT_SETTINGS, DIFFICULTIES, FIXED_DT, ITEM_NAMES, MODE_NAMES } from '../shared/config.js';
import { EMPTY_INPUT, type CharacterId, type Difficulty, type GameMode, type GameSnapshot, type InputState, type LobbySnapshot, type MapId, type MatchSettings, type PlayerSnapshot, type RosterPlayer } from '../shared/types.js';
import { createGame, predictLocalPlayer, snapshotGame, stepGame, type GameState } from '../shared/game.js';
import { createInput } from './input.js';
import { createRenderer, type GameRenderer } from './renderer.js';
import { connectRoom, type OnlineConnection } from './network.js';
import { esc, icon, portrait } from './ui.js';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const load = (key: string, fallback: string) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const save = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Storage may be disabled. */ } };
let playerName = load('beng-name', '玩家一号');
let character: CharacterId = (load('beng-character', 'uncle') in CHARACTERS ? load('beng-character', 'uncle') : 'uncle') as CharacterId;
let settings = { ...DEFAULT_SETTINGS };
let activeTab: 'practice' | 'online' = 'practice';
let practiceCount = 4;
let roster: RosterPlayer[] = [];
let game: GameState | null = null;
let latest: GameSnapshot | null = null;
let lobby: LobbySnapshot | null = null;
let connection: OnlineConnection | null = null;
let connecting = false;
let generation = 0;
let paused = false;
let sound = load('beng-sound', 'on') !== 'off';
let renderer: GameRenderer;
let resultsShown = false;
type Screen = 'home' | 'prepare' | 'loading' | 'play' | 'results';
let screen: Screen = 'home';
let launching = false;
let launchSerial = 0;
let rendererPromise: Promise<void> | null = null;
let lastHUD = 0;
let lastSceneKey = '';
let inputSequence = 0;
let prediction: PlayerSnapshot | null = null;
let predictionHistory: { input: InputState; dt: number }[] = [];
let predictionHitStop = 0;
let onlineHitStopUntil = 0;
const visualPositions = new Map<string, { x: number; y: number }>();
const actionLabels: Record<string, string> = { left: '左移动', right: '右移动', down: '下蹲防御（与跳跃组合下落）', jump: '跳跃 / 二段跳', pickup: '拾取道具', attack: '攻击 / 开火', dash: '突进闪避', skill1: '角色技能 1', skill2: '角色技能 2' };

$('#app').innerHTML = appLayout(playerName, sound);

const input = createInput($('#stage-canvas'), () => { if (renderer) renderer.setMuted(!sound); });
let waitingBinding = '';
let toastTimer: ReturnType<typeof setTimeout>;
const toast = (message: string) => { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3700); };
const ownId = () => connection?.sessionId ?? 'local-player';
const currentRoster = () => connection && lobby ? lobby.players : roster;
const inMatch = () => !!game || !!lobby?.started;
const isHost = () => !!connection && lobby?.hostId === connection.sessionId;
const canEdit = () => !inMatch() && (!connection || isHost());
const dialogOpen = () => !!document.querySelector('dialog[open]');
function advancePrediction(controls: InputState, dt: number): void {
  const frozen = Math.min(predictionHitStop, dt);
  predictionHitStop = Math.max(0, predictionHitStop - dt);
  if (prediction && dt - frozen > .000001) prediction = predictLocalPlayer(prediction, controls, dt - frozen, settings);
}
const keyLabel = (code: string) => ({ Space: '空格', ArrowLeft: '←', ArrowRight: '→', ArrowDown: '↓', ArrowUp: '↑', ShiftLeft: '左 Shift', ShiftRight: '右 Shift' }[code] ?? code.replace(/^Key/, '').replace(/^Digit/, ''));

function setScreen(next: Screen): void {
  if (next !== 'play' && document.fullscreenElement) void document.exitFullscreen().catch(() => { /* The browser may already be leaving fullscreen. */ });
  if (screen !== next) document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close());
  screen = next;
  document.body.dataset.screen = next;
  document.querySelectorAll<HTMLElement>('.page-screen').forEach(page => page.classList.toggle('hidden', page.id !== `${next}-screen`));
  $('#page-location').textContent = { home: '游戏桌面', prepare: '对战准备', loading: '对局加载', play: '正在对战', results: '游戏结算' }[next];
  history.replaceState(null, '', `#${next}`);
  input.clear(); window.scrollTo({ top: 0, behavior: 'instant' });
  if (next === 'play') requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}
function setLoadProgress(value: number, text: string): void {
  $<HTMLProgressElement>('#load-progress').value = value;
  $('#load-percent').textContent = `${value}%`; $('#load-status-text').textContent = text;
}
function renderLoading(): void {
  const map = ARENAS[settings.map];
  $<HTMLImageElement>('#loading-map-image').src = map.background;
  $<HTMLImageElement>('#loading-map-image').alt = map.subtitle;
  $('#loading-map-name').textContent = map.name;
  $('#loading-mode').textContent = `${MODE_NAMES[settings.mode]}，${currentRoster().length} 位选手即将出场`;
  $('#loading-roster').innerHTML = currentRoster().map((player, i) => `<article class="loading-fighter" style="--character-color:${CHARACTERS[player.character].color}"><span class="seat-label">P${i + 1}${settings.mode === '2v2' ? ` · ${player.team % 2 === 0 ? '蓝队' : '红队'}` : ''}</span><div class="portrait-wrap">${portrait(player.character)}</div><b>${CHARACTERS[player.character].name}</b><span>${esc(player.name)}</span><small>${player.bot ? DIFFICULTIES[player.difficulty] : '真人选手'}</small></article>`).join('');
  $('#load-error').classList.add('hidden');
}
async function ensureRenderer(): Promise<void> {
  if (renderer) { setLoadProgress(100, '地图与角色已就绪'); return; }
  if (!rendererPromise) rendererPromise = (async () => {
    setLoadProgress(10, '载入像素字体');
    await Promise.race([document.fonts.load('24px "Fusion Pixel"'), new Promise(resolve => setTimeout(resolve, 4000))]);
    setLoadProgress(35, '载入地图与角色');
    renderer = await createRenderer($('#stage-canvas'));
    renderer.setMuted(!sound); setLoadProgress(100, '地图与角色已就绪');
  })().catch(error => { rendererPromise = null; throw error; });
  await rendererPromise;
}
function showLoadError(error: unknown): void {
  launching = false; $('#load-error').classList.remove('hidden');
  $('#load-error-message').textContent = error instanceof Error ? error.message : '资源加载失败，请返回准备后重试。';
  $('#load-status-text').textContent = '加载未完成'; updateUI(false);
}
function openDialog(id: string): void {
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close());
  $<HTMLDialogElement>(id).showModal(); input.clear();
}
async function toggleOnlineReady(): Promise<void> {
  if (!connection || launching) return;
  const target = connection;
  const requestGeneration = generation;
  const ready = lobby?.players.find(p => p.id === ownId())?.ready;
  if (!ready) {
    launching = true; updateUI(false);
    try { await ensureRenderer(); } catch (error) {
      if (connection === target && generation === requestGeneration) { toast(error instanceof Error ? error.message : '地图加载失败，请重试。'); launching = false; updateUI(false); }
      return;
    }
    if (connection !== target || generation !== requestGeneration) return;
    launching = false;
  }
  target.send('ready', { ready: !ready }); updateUI(false);
}
function randomCharacters(): void {
  if (!canEdit()) return;
  if (connection) { connection.send('randomCharacters'); return; }
  const chars = Object.keys(CHARACTERS) as CharacterId[];
  const used = new Map<number, Set<CharacterId>>();
  for (const player of roster) {
    const team = used.get(player.team) ?? new Set<CharacterId>();
    const candidates = settings.mode === '2v2' ? chars.filter(id => !team.has(id)) : chars;
    player.character = candidates[Math.floor(Math.random() * candidates.length)];
    team.add(player.character); used.set(player.team, team);
  }
  character = roster[0].character; save('beng-character', character); updateUI();
}
async function enterOnlineMatch(): Promise<void> {
  const token = ++launchSerial;
  renderLoading(); setLoadProgress(0, '准备房间对局'); setScreen('loading');
  try {
    await ensureRenderer();
    if (token === launchSerial && lobby?.started && latest) setScreen(latest.phase === 'matchEnd' ? 'results' : 'play');
  } catch (error) { if (token === launchSerial) showLoadError(error); }
}
function syncAuthor(): void {
  const name = load('beng-author', '作者信息待设置');
  $('#author-credit').textContent = name;
}

function practiceRoster(): void {
  const count = settings.mode === '1v1' ? 2 : settings.mode === '2v2' ? 4 : practiceCount;
  const previous = roster;
  const chars = Object.keys(CHARACTERS) as CharacterId[];
  roster = Array.from({ length: count }, (_, i) => ({ id: i === 0 ? 'local-player' : `local-bot-${i}`, name: i === 0 ? playerName : `陪练 ${i}`, character: i === 0 ? character : previous[i]?.character ?? chars[i], team: settings.mode === '2v2' ? i % 2 : i, bot: i !== 0, difficulty: previous[i]?.difficulty ?? 'medium', ready: true }));
  if (settings.mode === '2v2') {
    const used = new Map<number, Set<CharacterId>>();
    for (const player of roster) {
      const team = used.get(player.team) ?? new Set<CharacterId>();
      if (team.has(player.character)) player.character = chars.find(candidate => !team.has(candidate))!;
      team.add(player.character); used.set(player.team, team);
    }
  }
}
function renderBindings(): void {
  $('#bindings-grid').innerHTML = Object.entries(actionLabels).map(([action, label]) => `<div><span>${label}</span><button data-action="bind" data-value="${action}" class="key-binding ${waitingBinding === action ? 'waiting' : ''}">${waitingBinding === action ? '请按新键…' : esc(keyLabel(input.bindings[action] || '未设置'))}</button></div>`).join('');
}
function renderRoster(): void {
  const players = currentRoster();
  $('#roster-grid').innerHTML = Array.from({ length: Math.max(players.length, settings.mode === '1v1' ? 2 : 4) }, (_, i) => {
    const p = players[i];
    if (!p) return `<div class="player-card empty"><span class="empty-plus">+</span><b>空位等你</b>${connection && isHost() && !inMatch() ? `<button class="text-button" data-action="add-bot">添加人机</button>` : '<small>好友加入后出现在这里</small>'}</div>`;
    const c = CHARACTERS[p.character];
    const editable = !inMatch() && (p.id === ownId() || p.bot && canEdit());
    const teamClass = settings.mode === '2v2' ? p.team % 2 === 0 ? ' blue-team' : ' red-team' : '';
    return `<article class="player-card${teamClass}${p.id === ownId() ? ' is-you' : ''}" style="--character-color:${c.color}"><div class="player-card-top"><span class="seat-label">P${i + 1} <i>${p.id === ownId() ? '你' : p.bot ? '人机' : '好友'}</i></span>${connection && !p.bot ? `<span class="ready-badge ${p.ready ? 'is-ready' : ''}">${p.ready ? '已准备' : '未准备'}</span>` : ''}${p.bot && canEdit() ? `<button class="remove-bot" data-action="remove-bot" data-value="${esc(p.id)}" aria-label="移除${esc(p.name)}">×</button>` : ''}</div><div class="player-identity"><div class="portrait-wrap">${portrait(p.character)}</div><div><strong>${esc(p.name)}</strong><small>${c.title}${settings.mode === '2v2' ? ` · ${p.team % 2 === 0 ? '蓝队' : '红队'}` : ''}</small></div></div><select class="character-select" aria-label="${esc(p.name)}的角色" data-character="${esc(p.id)}" ${editable ? '' : 'disabled'}>${Object.values(CHARACTERS).map(ch => `<option value="${ch.id}" ${p.character === ch.id ? 'selected' : ''}>${ch.name}</option>`).join('')}</select><div class="player-loadout"><span>${c.skill1}</span><span>${c.skill2}</span></div>${p.bot && !inMatch() ? `<div class="player-card-footer"><select aria-label="${esc(p.name)}的人机难度" data-difficulty="${esc(p.id)}" ${canEdit() ? '' : 'disabled'}>${Object.entries(DIFFICULTIES).map(([difficulty, title]) => `<option value="${difficulty}" ${p.difficulty === difficulty ? 'selected' : ''}>${title}</option>`).join('')}</select></div>` : ''}</article>`;
  }).join('');
}
function updateUI(rebuildRoster = true): void {
  const playing = inMatch();
  document.body.classList.toggle('is-playing', playing);
  document.body.classList.toggle('is-online', !!connection);
  const editable = canEdit();
  document.querySelectorAll<HTMLButtonElement>('[data-action="tab"]').forEach(el => { el.setAttribute('aria-selected', String(el.dataset.value === activeTab)); el.disabled = playing || connecting; });
  $('#online-panel').classList.toggle('hidden', activeTab !== 'online');
  $('#connect-form').classList.toggle('hidden', !!connection);
  $('#connected-room').classList.toggle('hidden', !connection);
  $('#player-name').toggleAttribute('disabled', playing);
  document.querySelectorAll<HTMLButtonElement>('[data-action="mode"]').forEach(el => { el.classList.toggle('selected', el.dataset.value === settings.mode); el.setAttribute('aria-pressed', String(el.dataset.value === settings.mode)); el.disabled = !editable; });
  document.querySelectorAll<HTMLButtonElement>('[data-action="map"]').forEach(el => { el.classList.toggle('selected', el.dataset.value === settings.map); el.setAttribute('aria-pressed', String(el.dataset.value === settings.map)); el.disabled = !editable; });
  $('#practice-count-row').classList.toggle('hidden', !!connection || activeTab === 'online' || settings.mode !== 'ffa');
  $('#player-count').toggleAttribute('disabled', !editable);
  $('#drop-interval').toggleAttribute('disabled', !editable || !settings.itemsEnabled);
  $<HTMLSelectElement>('#drop-interval').value = String(settings.dropInterval);
  $('#rounds-to-win').toggleAttribute('disabled', !editable || settings.mode === 'ffa');
  $<HTMLSelectElement>('#rounds-to-win').value = String(settings.roundsToWin);
  $<HTMLInputElement>('#items-enabled').checked = settings.itemsEnabled;
  $('#items-enabled').toggleAttribute('disabled', !editable);
  $<HTMLInputElement>('#friendly-fire').checked = settings.friendlyFire;
  $('#friendly-fire').toggleAttribute('disabled', !editable || settings.mode !== '2v2');
  $('#arena-title').textContent = ARENAS[settings.map].name;
  $('#mode-pill').textContent = MODE_NAMES[settings.mode];
  $('#count-pill').textContent = `${currentRoster().length} / ${settings.mode === '1v1' ? 2 : 4} 就位`;
  $('#connection-label').textContent = connection ? `房间 ${connection.id}` : activeTab === 'online' ? '好友专属擂台' : '本地练习场';
  const start = $<HTMLButtonElement>('#start-button');
  if (playing) { start.innerHTML = `${icon('game', 20)} 正在对战`; start.disabled = true; }
  else if (activeTab === 'practice') { start.innerHTML = `${icon('play', 18)} 开始练习`; start.disabled = launching; }
  else if (!connection) { start.textContent = connecting ? '连接房间中…' : '先创建或加入房间'; start.disabled = true; }
  else if (isHost()) { start.innerHTML = `${icon('play', 18)} 房主开始`; start.disabled = !lobby?.canStart; }
  else { const me = lobby?.players.find(p => p.id === ownId()); start.innerHTML = `${me?.ready ? '取消准备' : '我准备好了'} ${icon('check', 21)}`; start.disabled = false; }
  $('#start-hint').textContent = playing ? '角色、地图和规则已锁定。' : activeTab === 'practice' ? '一个人也能开打，人机已经就位。' : !connection ? '创建房间，把房间码告诉朋友。' : isHost() ? '全员准备后，即可开局。' : '准备后等待房主开始。';
  if (launching) start.disabled = true;
  $<HTMLButtonElement>('#random-characters').disabled = !editable;
  $<HTMLButtonElement>('#random-difficulty').disabled = !editable || !currentRoster().some(player => player.bot);
  $<HTMLButtonElement>('#random-map').disabled = !editable;
  $('#play-mode').textContent = MODE_NAMES[settings.mode];
  $('#play-map-name').textContent = ARENAS[settings.map].name;
  $<HTMLInputElement>('#sound-enabled').checked = sound;
  $<HTMLInputElement>('#touch-enabled').checked = document.body.classList.contains('force-touch');
  $('#settings-match-note').textContent = connection && playing ? '联机对局会继续进行。关闭设置即可继续操作。' : playing ? '设置打开期间，本地对局暂停；关闭设置继续。' : '设置保存在当前浏览器。手机也可以横屏游玩。';
  $('#quit-match').classList.toggle('hidden', !playing);
  if (connection) {
    $('#room-id').textContent = connection.id;
    $('#room-note').textContent = isHost() ? '你是房主，可以编辑规则、添加人机。' : '规则由房主设置；你可以选择自己的角色。';
    $('#ready-toggle').classList.toggle('hidden', !isHost() || playing);
    $('#ready-toggle').textContent = lobby?.players.find(p => p.id === ownId())?.ready ? '✓ 已准备，点击取消' : '我准备好了';
  }
  $<HTMLButtonElement>('#pause-button').disabled = !game;
  $<HTMLButtonElement>('#back-button').disabled = !playing || !!connection && !isHost();
  $('#pause-cover').classList.toggle('hidden', !paused);
  $('#pause-button').innerHTML = `${icon(paused ? 'arrow' : 'pause', 14)} ${paused ? '继续' : '暂停'}`;
  if (!playing) $('#match-note').innerHTML = `${icon('box', 16)} <span>${settings.itemsEnabled ? `每 ${settings.dropInterval} 秒，${currentRoster().length} 件空投随机降落` : '本局关闭道具，纯粹较量手感'}</span>`;
  if (rebuildRoster) renderRoster();
  const sceneKey = `${settings.map}:${currentRoster().map(p => `${p.id}/${p.character}/${p.team}`).join('|')}`;
  if (renderer && !playing && sceneKey !== lastSceneKey) { renderer.preview(settings.map, currentRoster()); lastSceneKey = sceneKey; }
  document.querySelectorAll<HTMLButtonElement>('[data-action="create"],[data-action="join"]').forEach(el => el.disabled = connecting);
}
function changeSettings(partial: Partial<MatchSettings>): void {
  if (!canEdit()) return;
  if (connection) { connection.send('settings', partial); return; }
  settings = { ...settings, ...partial };
  practiceRoster();
  updateUI();
}
function commitPlayerName(): void {
  const field = $<HTMLInputElement>('#player-name');
  playerName = field.value.trim().slice(0, 12) || '玩家一号';
  field.value = playerName;
  save('beng-name', playerName);
}
async function startPractice(): Promise<void> {
  if (launching) return;
  const token = ++launchSerial;
  commitPlayerName(); practiceRoster();
  launching = true; paused = false; resultsShown = false;
  game = null; latest = null;
  renderLoading(); setLoadProgress(0, '准备本局资源'); setScreen('loading'); updateUI(false);
  const startedAt = performance.now();
  try {
    await ensureRenderer();
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 700 - (performance.now() - startedAt))));
  } catch (error) { if (token === launchSerial) showLoadError(error); return; }
  if (token !== launchSerial) return;
  launching = false;
  game = createGame(settings, roster, Date.now() >>> 0);
  latest = snapshotGame(game);
  paused = false; resultsShown = false;
  input.clear(); renderer.setMuted(!sound); setScreen('play'); updateUI();
}
async function leaveRoom(showToast = true): Promise<void> {
  generation++;
  const old = connection; connection = null; lobby = null; latest = null; prediction = null;
  predictionHitStop = 0; onlineHitStopUntil = 0;
  predictionHistory = []; visualPositions.clear(); game = null; paused = false; resultsShown = false; connecting = false;
  launchSerial++; launching = false; input.clear();
  if (old) try { await old.leave(); } catch { /* Already disconnected. */ }
  practiceRoster(); lastSceneKey = ''; setScreen('prepare'); updateUI();
  if (old && showToast) toast('已退出房间。');
}
async function openRoom(mode: 'create' | 'join'): Promise<void> {
  if (connecting || connection) return;
  commitPlayerName();
  const code = $<HTMLInputElement>('#room-code').value.trim().toUpperCase();
  if (mode === 'join' && !/^[A-Z0-9]{6}$/.test(code)) { toast('请输入 6 位字母或数字房间码。'); return; }
  connecting = true; updateUI(false);
  const requestGeneration = ++generation;
  try {
    const room = await connectRoom(mode, { name: playerName, character, code, settings }, {
      onLobby: value => {
        if (generation !== requestGeneration) return;
        const wasStarted = !!lobby?.started;
        lobby = value; settings = { ...value.settings };
        const ownProfile = value.players.find(player => player.id === ownId());
        if (ownProfile) { character = ownProfile.character; save('beng-character', character); }
        if (!value.started) { latest = null; prediction = null; predictionHitStop = 0; onlineHitStopUntil = 0; predictionHistory = []; visualPositions.clear(); resultsShown = false; lastSceneKey = ''; if (wasStarted || screen === 'results' || screen === 'loading') setScreen('prepare'); }
        if (!wasStarted && value.started) void enterOnlineMatch();
        if (wasStarted !== value.started) input.clear();
        updateUI();
      },
      onState: state => {
        if (generation !== requestGeneration) return;
        if (latest?.phase === 'matchEnd' && state.phase !== 'matchEnd') {
          resultsShown = false; predictionHistory = []; visualPositions.clear();
          input.clear(); void enterOnlineMatch();
        }
        latest = state;
        predictionHitStop = state.hitStop;
        onlineHitStopUntil = performance.now() + state.hitStop * 1000;
        if (screen === 'loading' && renderer && state.phase !== 'matchEnd') { launching = false; setScreen('play'); }
        const me = state.players.find(p => p.id === ownId());
        if (me) {
          const ack = me.lastInputSeq ?? -1;
          predictionHistory = predictionHistory.filter(frame => (frame.input.seq ?? 0) > ack).slice(-90);
          prediction = structuredClone(me);
          if (state.phase === 'playing' && !me.dead) for (const frame of predictionHistory) advancePrediction(frame.input, frame.dt);
        }
      },
      onError: message => { if (generation === requestGeneration) toast(message); },
      onLeave: () => { if (generation === requestGeneration) { void leaveRoom(false); toast('连接已断开，可以重新加入房间。'); } },
    });
    if (generation !== requestGeneration) { await room.leave(); return; }
    connection = room; connecting = false; inputSequence = 0;
    room.send('requestLobby'); updateUI();
    toast(mode === 'create' ? `房间 ${room.id} 已开好，叫上朋友吧。` : '加入成功，选好角色后准备。');
  } catch (error) {
    if (generation !== requestGeneration) return;
    connecting = false; toast(error instanceof Error ? error.message : '连接失败，请检查游戏服务是否启动。'); updateUI(false);
  }
}
function backToLobby(): void {
  launchSerial++; launching = false; input.clear();
  if (connection) { if (isHost()) connection.send('backToLobby'); return; }
  game = null; latest = null; paused = false; resultsShown = false; lastSceneKey = ''; setScreen('prepare'); updateUI();
}
function showResults(state: GameSnapshot): void {
  if (resultsShown) return;
  resultsShown = true;
  $('#result-title').textContent = state.result || '本局结束';
  $('#result-subtitle').textContent = state.settings.mode === 'ffa' ? '击败 +2 · 助攻 +1 · 死亡 −1，同分依次比较击败和有效伤害。' : `第 ${state.round} 轮落幕，先赢 ${state.settings.roundsToWin} 轮获胜。`;
  const players = [...state.players].sort((a, b) => (state.settings.mode === 'ffa' ? b.score - a.score : (state.roundWins[b.team] ?? 0) - (state.roundWins[a.team] ?? 0)) || b.kills - a.kills || b.damage - a.damage);
  $('#result-roster').innerHTML = players.map(p => `<span class="result-fighter" style="--character-color:${CHARACTERS[p.character].color}">${portrait(p.character)}<b>${esc(p.name)}</b></span>`).join('');
  $('#result-table').innerHTML = `<table><thead><tr><th>选手</th><th>击败</th><th>助攻</th><th>死亡</th><th>有效伤害</th><th>${state.settings.mode === 'ffa' ? '积分' : '回合胜'}</th></tr></thead><tbody>${players.map(p => `<tr><td><i style="background:${CHARACTERS[p.character].color}"></i>${esc(p.name)}${p.id === ownId() ? ' <small>你</small>' : ''}</td><td>${p.kills}</td><td>${p.assists}</td><td>${p.deaths}</td><td>${Math.round(p.damage)}</td><td><b>${state.settings.mode === 'ffa' ? p.score : state.roundWins[p.team] ?? 0}</b></td></tr>`).join('')}</tbody></table>`;
  $<HTMLButtonElement>('#rematch-button').disabled = !!connection && !isHost();
  $('#rematch-button').innerHTML = `${connection && !isHost() ? '等待房主再来一局' : '再来一局'} ${icon('arrow')}`;
  $<HTMLButtonElement>('#result-back').disabled = !!connection && !isHost();
  setScreen('results'); input.clear();
}
function updateHUD(state: GameSnapshot): void {
  $('#match-note').innerHTML = `${icon('box', 16)} <span>${state.settings.itemsEnabled ? `下一轮空投 ${Math.max(0, Math.ceil(state.dropIn))} 秒 · ${state.players.length} 件` : '本局关闭道具'}${state.settings.mode !== 'ffa' && state.timeLeft <= 15 ? ' · 安全区正在缩小' : ''}</span>`;
  const local = state.players.find(player => player.id === ownId());
  if (local) {
    for (const [action, name, remaining] of [ ['dash', '突进', local.cd.dash], ['skill1', CHARACTERS[local.character].skill1, local.cd.skill1], ['skill2', CHARACTERS[local.character].skill2, local.cd.skill2] ] as const) {
      const button = document.querySelector<HTMLButtonElement>(`[data-control="${action}"]`)!;
      button.textContent = remaining > 0 ? `${Math.ceil(remaining)}s` : name;
      button.classList.toggle('cooling', remaining > 0);
    }
    document.querySelector<HTMLButtonElement>('[data-control="attack"]')!.textContent = local.heldItem ? `使用 ${local.ammo}` : '攻击';
  }
  if (state.phase === 'matchEnd') showResults(state); else resultsShown = false;
}

document.addEventListener('click', async event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  const value = button.dataset.value;
  if (action === 'home-start') { setScreen('prepare'); updateUI(); }
  else if (action === 'home' || action === 'quit-match') {
    if (connection || connecting) await leaveRoom(false); else backToLobby();
    setScreen('home'); syncAuthor();
  } else if (action === 'cancel-loading') { launchSerial++; launching = false; if (connection) await leaveRoom(false); else { game = null; latest = null; setScreen('prepare'); updateUI(); } }
  else if (action === 'catalog') {
    const data = catalogMarkup(value as 'characters' | 'maps' | 'items' | 'author');
    $('#catalog-title').textContent = data.title; $('#catalog-subtitle').textContent = data.subtitle; $('#catalog-content').innerHTML = data.html; openDialog('#catalog-dialog');
  } else if (action === 'save-author') {
    save('beng-author', $<HTMLInputElement>('#author-name').value.trim().slice(0, 24));
    save('beng-author-description', $<HTMLTextAreaElement>('#author-description').value.trim().slice(0, 140));
    syncAuthor(); toast('作者信息已保存在当前浏览器。');
  } else if (action === 'settings') { updateUI(false); openDialog('#settings-dialog'); }
  else if (action === 'random-characters') randomCharacters();
  else if (action === 'random-difficulty') {
    if (canEdit()) {
      if (connection) connection.send('randomDifficulties');
      else { const levels = Object.keys(DIFFICULTIES) as Difficulty[]; roster.forEach(player => { if (player.bot) player.difficulty = levels[Math.floor(Math.random() * levels.length)]; }); updateUI(); }
    }
  }
  else if (action === 'random-map') { const maps = Object.keys(ARENAS) as MapId[]; changeSettings({ map: maps[Math.floor(Math.random() * maps.length)] }); }
  else if (action === 'tab') {
    if (inMatch()) return;
    if (connection) await leaveRoom(false);
    activeTab = value as 'practice' | 'online'; updateUI();
  } else if (action === 'mode') changeSettings({ mode: value as GameMode });
  else if (action === 'map') changeSettings({ map: value as MapId });
  else if (action === 'start') {
    if (activeTab === 'practice') await startPractice();
    else if (connection) {
      if (isHost()) {
        const active = connection; const requestGeneration = generation;
        launching = true; updateUI(false);
        try { await ensureRenderer(); if (connection === active && generation === requestGeneration) active.send('start'); }
        catch (error) { if (connection === active && generation === requestGeneration) toast(error instanceof Error ? error.message : '地图加载失败，请重试。'); }
        finally { if (connection === active && generation === requestGeneration) { launching = false; updateUI(false); } }
      } else await toggleOnlineReady();
    }
  } else if (action === 'create' || action === 'join') await openRoom(action);
  else if (action === 'leave') await leaveRoom();
  else if (action === 'ready' && connection) await toggleOnlineReady();
  else if (action === 'add-bot' && connection) connection.send('addBot', { character: (Object.keys(CHARACTERS) as CharacterId[])[lobby?.players.length ?? 1], difficulty: 'medium' });
  else if (action === 'remove-bot' && value) {
    if (connection) connection.send('removeBot', { id: value });
    else if (settings.mode === 'ffa' && roster.length > 2) { practiceCount = roster.length - 1; practiceRoster(); $<HTMLSelectElement>('#player-count').value = String(practiceCount); updateUI(); }
    else toast('当前模式需要这些席位；可以调整混战人数。');
  } else if (action === 'copy' && connection) { try { await navigator.clipboard.writeText(connection.id); toast('房间码已复制，发给朋友吧。'); } catch { toast(`房间码：${connection.id}`); } }
  else if (action === 'pause' && game) { paused = !paused; input.clear(); updateUI(false); }
  else if (action === 'back' || action === 'result-back') backToLobby();
  else if (action === 'rematch') { if (connection) connection.send('rematch'); else await startPractice(); }
  else if (action === 'sound') { sound = !sound; save('beng-sound', sound ? 'on' : 'off'); renderer?.setMuted(!sound); button.innerHTML = icon(sound ? 'volume' : 'mute'); button.title = sound ? '关闭音效' : '开启音效'; updateUI(false); }
  else if (action === 'fullscreen') { try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('#arena-frame').requestFullscreen(); } catch { toast('当前浏览器不支持全屏，可横屏游玩。'); } }
  else if (action === 'touch') { document.body.classList.toggle('force-touch'); save('beng-touch', document.body.classList.contains('force-touch') ? 'on' : 'off'); button.classList.toggle('active'); updateUI(false); }
  else if (action === 'configure') $('.setup-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  else if (action === 'bindings') { renderBindings(); openDialog('#bindings-dialog'); }
  else if (action === 'help') openDialog('#help-dialog');
  else if (action === 'close-dialog') { button.closest<HTMLDialogElement>('dialog')?.close(); waitingBinding = ''; input.clear(); }
  else if (action === 'bind' && value) { waitingBinding = value; renderBindings(); input.clear(); }
});
document.addEventListener('input', event => {
  const field = event.target as HTMLInputElement;
  if (field.id !== 'player-name' || connection || inMatch()) return;
  playerName = field.value.trim().slice(0, 12) || '玩家一号';
  practiceRoster(); renderRoster();
});
document.addEventListener('change', event => {
  const el = event.target as HTMLInputElement | HTMLSelectElement;
  if (el.id === 'sound-enabled') {
    sound = (el as HTMLInputElement).checked; save('beng-sound', sound ? 'on' : 'off'); renderer?.setMuted(!sound);
    document.querySelectorAll<HTMLElement>('[data-action="sound"]').forEach(button => button.innerHTML = icon(sound ? 'volume' : 'mute'));
  } else if (el.id === 'touch-enabled') {
    document.body.classList.toggle('force-touch', (el as HTMLInputElement).checked);
    save('beng-touch', (el as HTMLInputElement).checked ? 'on' : 'off');
  } else if (el.id === 'player-name') {
    commitPlayerName();
    if (connection) connection.send('profile', { name: playerName, character }); else { practiceRoster(); updateUI(); }
  } else if (el.id === 'player-count') { practiceCount = Number(el.value); practiceRoster(); updateUI(); }
  else if (el.id === 'drop-interval') changeSettings({ dropInterval: Number(el.value) });
  else if (el.id === 'rounds-to-win') changeSettings({ roundsToWin: Number(el.value) });
  else if (el.id === 'items-enabled') changeSettings({ itemsEnabled: (el as HTMLInputElement).checked });
  else if (el.id === 'friendly-fire') changeSettings({ friendlyFire: (el as HTMLInputElement).checked });
  else if (el.dataset.character) {
    const id = el.dataset.character;
    if (id === ownId()) {
      const own = currentRoster().find(player => player.id === id);
      if (!connection && settings.mode === '2v2' && own && roster.some(other => other.id !== id && other.team === own.team && other.character === el.value)) { toast('同队角色不能重复，换一个搭档吧。'); updateUI(); return; }
      character = el.value as CharacterId; save('beng-character', character);
      if (connection) connection.send('profile', { character, name: playerName }); else { practiceRoster(); updateUI(); }
    }
    else if (connection) connection.send('updateBot', { id, character: el.value });
    else { const p = roster.find(p => p.id === id); if (p) {
      if (settings.mode === '2v2' && roster.some(other => other.id !== id && other.team === p.team && other.character === el.value)) { toast('同队角色不能重复，换一个搭档吧。'); }
      else p.character = el.value as CharacterId;
    } updateUI(); }
  } else if (el.dataset.difficulty) {
    if (connection) connection.send('updateBot', { id: el.dataset.difficulty, difficulty: el.value });
    else { const p = roster.find(p => p.id === el.dataset.difficulty); if (p) p.difficulty = el.value as Difficulty; updateUI(); }
  }
});
window.addEventListener('keydown', event => {
  if (!waitingBinding || !$<HTMLDialogElement>('#bindings-dialog').open) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (event.code !== 'Escape') { input.setBinding(waitingBinding, event.code); toast('按键已保存。'); }
  waitingBinding = ''; input.clear(); renderBindings();
}, true);
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', () => { waitingBinding = ''; input.clear(); }));
window.addEventListener('blur', () => { input.clear(); if (game) { paused = true; updateUI(false); } });

document.body.classList.toggle('force-touch', load('beng-touch', 'off') === 'on');
renderBindings(); practiceRoster(); setScreen('home'); updateUI(); syncAuthor();

let previous = performance.now();
let accumulator = 0;
const pressedSinceStep = { ...EMPTY_INPUT };
const pressActions = ['down', 'jump', 'pickup', 'attack', 'dash', 'skill1', 'skill2'] as const;
function frame(now: number): void {
  const elapsed = Math.min((now - previous) / 1000, 0.1); previous = now;
  accumulator += elapsed;
  const controls = dialogOpen() || paused || screen !== 'play' ? { ...EMPTY_INPUT } : input.read();
  for (const action of pressActions) if (controls[action]) pressedSinceStep[action] = true;
  while (accumulator >= FIXED_DT) {
    accumulator -= FIXED_DT;
    const steppedControls = { ...controls };
    for (const action of pressActions) steppedControls[action] ||= pressedSinceStep[action];
    if (game && screen === 'play' && !paused && !dialogOpen()) stepGame(game, { 'local-player': steppedControls }, FIXED_DT);
    else if (connection && lobby?.started) {
      const predictedInput = { ...steppedControls, seq: ++inputSequence };
      connection.input(predictedInput);
      if (latest?.phase === 'playing' && prediction && !prediction.dead) {
        advancePrediction(predictedInput, FIXED_DT);
        predictionHistory.push({ input: predictedInput, dt: FIXED_DT });
        if (predictionHistory.length > 90) predictionHistory.shift();
      }
    }
    for (const action of pressActions) pressedSinceStep[action] = false;
  }
  if (game) latest = snapshotGame(game);
  if (renderer && latest) {
    let visual = latest;
    if (connection) {
      const frozen = now < onlineHitStopUntil;
      visual = { ...latest, hitStop: Math.max(0, (onlineHitStopUntil - now) / 1000), players: latest.players.map(p => {
        if (p.id === ownId() && prediction && latest!.phase === 'playing' && !p.dead) return { ...p, x: prediction.x, y: prediction.y, vx: prediction.vx, vy: prediction.vy, facing: prediction.facing, grounded: prediction.grounded, blocking: prediction.blocking };
        let position = visualPositions.get(p.id);
        if (!position || frozen || Math.abs(position.x - p.x) + Math.abs(position.y - p.y) > 260 || p.dead) position = { x: p.x, y: p.y };
        const amount = 1 - Math.exp(-elapsed * 26);
        position.x += (p.x - position.x) * amount; position.y += (p.y - position.y) * amount;
        visualPositions.set(p.id, position);
        return { ...p, ...position };
      }) };
    }
    renderer.render(visual, ownId());
    if (now - lastHUD > 120) { updateHUD(latest); lastHUD = now; }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

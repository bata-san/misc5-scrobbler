import { render } from 'solid-js/web';
import { createResource, createSignal, For, Show } from 'solid-js';
import browser from 'webextension-polyfill';
import connectors, { type ConnectorMeta } from '@/core/connectors';
import * as Options from '@/core/storage/options';
import { Anchor } from '../components/util';
import styles from './settings.module.scss';

const PRIVACY_POLICY_URL = 'https://misc5-shelf.butter3.workers.dev/privacy';
const SHELF_APP_URL = 'https://misc5-shelf.butter3.workers.dev/';
const SHELF_APP_MATCH = `${SHELF_APP_URL}*`;
const PLAYBACK_ORIGINS = ['http://*/*', 'https://*/*'];

type ShelfConnection = { account: string };
type ShelfStorage = { Shelf?: { connection?: ShelfConnection } };
type BooleanSetting =
	| typeof Options.USE_NOTIFICATIONS
	| typeof Options.USE_INFOBOX
	| typeof Options.SCROBBLE_PODCASTS
	| typeof Options.SCROBBLE_RECOGNIZED_TRACKS
	| typeof Options.DEBUG_LOGGING_ENABLED;
type ExtensionSettings = Pick<
	Options.GlobalOptions,
	| typeof Options.USE_NOTIFICATIONS
	| typeof Options.USE_INFOBOX
	| typeof Options.SCROBBLE_PODCASTS
	| typeof Options.SCROBBLE_RECOGNIZED_TRACKS
	| typeof Options.SCROBBLE_PERCENT
	| typeof Options.DEBUG_LOGGING_ENABLED
	| typeof Options.DISABLED_CONNECTORS
>;

const playbackToggles: { key: BooleanSetting; label: string; detail: string }[] = [
	{
		key: Options.USE_NOTIFICATIONS,
		label: '再生通知',
		detail: '曲の再生開始をブラウザ通知で知らせます。',
	},
	{
		key: Options.USE_INFOBOX,
		label: '再生情報',
		detail: '対応サイト上に再生情報を表示します。',
	},
	{
		key: Options.SCROBBLE_RECOGNIZED_TRACKS,
		label: '認識済みのみ同期',
		detail: '曲名とアーティストを確認できた再生だけを保存します。',
	},
];

async function readConnection(): Promise<ShelfConnection | null> {
	const stored = (await browser.storage.local.get('Shelf')) as ShelfStorage;
	return stored.Shelf?.connection ?? null;
}

async function readSettings(): Promise<ExtensionSettings> {
	const [notifications, infobox, podcasts, recognized, percent, debug, disabled] =
		await Promise.all([
			Options.getOption(Options.USE_NOTIFICATIONS),
			Options.getOption(Options.USE_INFOBOX),
			Options.getOption(Options.SCROBBLE_PODCASTS),
			Options.getOption(Options.SCROBBLE_RECOGNIZED_TRACKS),
			Options.getOption(Options.SCROBBLE_PERCENT),
			Options.getOption(Options.DEBUG_LOGGING_ENABLED),
			Options.getOption(Options.DISABLED_CONNECTORS),
		]);
	return {
		[Options.USE_NOTIFICATIONS]: notifications !== false,
		[Options.USE_INFOBOX]: infobox !== false,
		[Options.SCROBBLE_PODCASTS]: podcasts !== false,
		[Options.SCROBBLE_RECOGNIZED_TRACKS]: recognized !== false,
		[Options.SCROBBLE_PERCENT]: typeof percent === 'number' ? percent : 50,
		[Options.DEBUG_LOGGING_ENABLED]: debug === true,
		[Options.DISABLED_CONNECTORS]:
			disabled && typeof disabled === 'object'
				? (disabled as Record<string, boolean>)
				: {},
	};
}

async function advanceConnectedShelfPages() {
	const tabs = await browser.tabs.query({ url: [SHELF_APP_MATCH] });
	await Promise.all(
		tabs
			.filter((tab) => typeof tab.id === 'number')
			.map((tab) =>
				browser.scripting
					.executeScript({
						target: { tabId: tab.id as number },
						func: () => {
							window.postMessage(
								{
									source: 'misc5-shelf-extension',
									type: 'sync-access-granted',
								},
								window.location.origin,
							);
						},
					})
					.catch(() => undefined),
			),
	);
}

function Toggle(props: {
	label: string;
	detail: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	const state = () => (props.checked ? 'ON' : 'OFF');
	return (
		<label class={styles.toggleRow} data-state={state()}>
			<span>
				<strong>{props.label}</strong>
				<small>{props.detail}</small>
			</span>
			<span class={styles.toggleControl}>
				<input
					type="checkbox"
					aria-label={`${props.label}: ${state()}`}
					checked={props.checked}
					onInput={(event) => props.onChange(event.currentTarget.checked)}
				/>
				<span class={styles.toggleState} aria-hidden="true">{state()}</span>
				<i aria-hidden="true" />
			</span>
		</label>
	);
}

/** MISC5専用の接続導線と、Web Scrobbler由来の再生設定をまとめた設定画面。 */
function Settings() {
	const [connection] = createResource(readConnection);
	const [settings, { refetch: refetchSettings }] = createResource(readSettings);
	const [playbackAccess, { refetch: refetchPlaybackAccess }] = createResource(
		() => browser.permissions.contains({ origins: PLAYBACK_ORIGINS }),
	);
	const [filter, setFilter] = createSignal('');
	const version = browser.runtime.getManifest().version;
	const visibleConnectors = () => {
		const query = filter().trim().toLowerCase();
		return query
			? connectors.filter((connector) => connector.label.toLowerCase().includes(query))
			: connectors;
	};

	const updateBoolean = (key: BooleanSetting, value: boolean) => {
		void Options.setOption(key, value).then(() => refetchSettings());
	};
	const updatePercent = (value: number) => {
		void Options.setOption(Options.SCROBBLE_PERCENT, value).then(() =>
			refetchSettings(),
		);
	};
	const updateConnector = (connector: ConnectorMeta, enabled: boolean) => {
		void Options.setConnectorEnabled(connector, enabled).then(() =>
			refetchSettings(),
		);
	};
	const requestPlaybackAccess = () => {
		void browser.permissions
			.request({ origins: PLAYBACK_ORIGINS })
			.then(async (granted) => {
				await refetchPlaybackAccess();
				if (granted) {
					await advanceConnectedShelfPages();
				}
			});
	};
	const jumpTo = (id: string) => {
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	};

	return (
		<main class={styles.page}>
			<header class={styles.header}>
				<div>
					<p class={styles.kicker}>MISC5 / EXTENSION SETTINGS</p>
					<h1>シェルフ設定</h1>
				</div>
				<p class={styles.version}>BUILD {version}</p>
			</header>

			<div class={styles.shell}>
				<aside class={styles.sidebar} aria-label="設定セクション">
					<p class={styles.sidebarLabel}>SECTIONS</p>
					<button type="button" onClick={() => jumpTo('connection')}>01 / 接続</button>
					<button type="button" onClick={() => jumpTo('sync')}>02 / 同期</button>
					<button type="button" onClick={() => jumpTo('playback')}>03 / 再生と表示</button>
					<button type="button" onClick={() => jumpTo('sites')}>04 / 対応サイト</button>
					<button type="button" onClick={() => jumpTo('system')}>05 / 詳細</button>
				</aside>

				<div class={styles.content}>
					<section id="connection" class={styles.section}>
						<div class={styles.sectionHeading}>
							<span class={styles.signal} aria-hidden="true" />
							<p>01 / CONNECTION</p>
						</div>
						<h2>アカウント連携</h2>
						<Show when={!connection.loading} fallback={<p class={styles.copy}>接続状態を確認中です。</p>}>
							<Show
								when={connection()}
								fallback={<p class={styles.copy}>未接続です。接続が完了すると、ここに同期先のアカウントが表示されます。</p>}
							>
								<p class={styles.account}>CONNECTED / {connection()?.account}</p>
								<p class={styles.copy}>アカウントを変更するまで、再生履歴は自動でシェルフへ同期されます。</p>
								<Show when={!playbackAccess.loading && !playbackAccess()}>
									<p class={styles.permissionCopy}>同期するには、すべてのサイトへのアクセスを有効にしてください。</p>
									<button class={styles.permissionAction} type="button" onClick={requestPlaybackAccess}>
										すべてのサイトへのアクセスを有効化
									</button>
								</Show>
							</Show>
						</Show>
					</section>

					<section id="sync" class={styles.section}>
						<div class={styles.sectionHeading}>
							<span class={styles.signal} aria-hidden="true" />
							<p>02 / SYNC</p>
						</div>
						<h2>同期のタイミング</h2>
						<div class={styles.rangeRow}>
							<label for="scrobble-percent">再生時間</label>
							<output>{settings()?.[Options.SCROBBLE_PERCENT] ?? 50}%</output>
						</div>
						<input
							id="scrobble-percent"
							class={styles.range}
							type="range"
							min="10"
							max="100"
							step="5"
							value={settings()?.[Options.SCROBBLE_PERCENT] ?? 50}
							onInput={(event) => updatePercent(Number(event.currentTarget.value))}
						/>
						<p class={styles.copy}>この割合まで再生すると、履歴をシェルフへ確定保存します。</p>
						<div class={styles.toggleList}>
							<Toggle
								label="ポッドキャストを同期"
								detail="音楽以外のポッドキャスト再生もシェルフへ送ります。"
								checked={settings()?.[Options.SCROBBLE_PODCASTS] ?? false}
								onChange={(value) => updateBoolean(Options.SCROBBLE_PODCASTS, value)}
							/>
						</div>
					</section>

					<section id="playback" class={styles.section}>
						<div class={styles.sectionHeading}>
							<span class={styles.signal} aria-hidden="true" />
							<p>03 / PLAYBACK</p>
						</div>
						<h2>再生と表示</h2>
						<div class={styles.toggleList}>
							<For each={playbackToggles}>
								{(toggle) => (
									<Toggle
										label={toggle.label}
										detail={toggle.detail}
										checked={settings()?.[toggle.key] ?? false}
										onChange={(value) => updateBoolean(toggle.key, value)}
									/>
								)}
							</For>
						</div>
					</section>

					<section id="sites" class={styles.section}>
						<div class={styles.sectionHeading}>
							<span class={styles.signal} aria-hidden="true" />
							<p>04 / SUPPORTED SITES</p>
						</div>
						<h2>対応サイト</h2>
						<p class={styles.copy}>Web Scrobbler本家の対応サイトを個別に有効・無効にできます。</p>
						<input
							class={styles.search}
							type="search"
							placeholder="サイトを検索"
							value={filter()}
							onInput={(event) => setFilter(event.currentTarget.value)}
						/>
						<div class={styles.connectorList}>
							<For each={visibleConnectors()}>
								{(connector) => (
									<Toggle
										label={connector.label}
										detail={connector.matches?.[0]?.replaceAll('*://', '') || 'ローカル連携'}
										checked={!settings()?.[Options.DISABLED_CONNECTORS]?.[connector.id]}
										onChange={(value) => updateConnector(connector, value)}
									/>
								)}
							</For>
						</div>
					</section>

					<section id="system" class={styles.section}>
						<div class={styles.sectionHeading}>
							<span class={styles.signal} aria-hidden="true" />
							<p>05 / DETAIL</p>
						</div>
						<h2>詳細</h2>
						<div class={styles.toggleList}>
							<Toggle
								label="デバッグログ"
								detail="ブラウザの開発者ツールへ同期処理のログを出力します。"
								checked={settings()?.[Options.DEBUG_LOGGING_ENABLED] ?? false}
								onChange={(value) => updateBoolean(Options.DEBUG_LOGGING_ENABLED, value)}
							/>
						</div>
						<Anchor
							class={styles.privacyLink}
							href={PRIVACY_POLICY_URL}
							target="_blank"
						>
							プライバシーポリシーを見る ↗
						</Anchor>
					</section>
				</div>
			</div>
		</main>
	);
}

const root = document.getElementById('root');
if (!root) {
	throw new Error('Root element not found');
}
render(Settings, root);

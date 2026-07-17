import { render } from 'solid-js/web';
import styles from './settings.module.scss';
import { createResource, For, Show } from 'solid-js';
import browser from 'webextension-polyfill';
import * as Options from '@/core/storage/options';

const SHELF_ORIGIN = 'https://misc5-shelf.butter3.workers.dev';

type ShelfConnection = { account: string; origin: string };
type ShelfStorage = { Shelf?: { connection?: ShelfConnection } };
type BooleanSetting =
	| typeof Options.USE_NOTIFICATIONS
	| typeof Options.USE_INFOBOX
	| typeof Options.SCROBBLE_PODCASTS
	| typeof Options.SCROBBLE_RECOGNIZED_TRACKS;
type ExtensionSettings = Pick<
	Options.GlobalOptions,
	| typeof Options.USE_NOTIFICATIONS
	| typeof Options.USE_INFOBOX
	| typeof Options.SCROBBLE_PODCASTS
	| typeof Options.SCROBBLE_RECOGNIZED_TRACKS
	| typeof Options.SCROBBLE_PERCENT
>;

const toggles: { key: BooleanSetting; label: string; detail: string }[] = [
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
	{
		key: Options.SCROBBLE_PODCASTS,
		label: 'ポッドキャストを同期',
		detail: '音楽以外のポッドキャスト再生も棚へ送ります。',
	},
];

async function readConnection(): Promise<ShelfConnection | null> {
	const stored = (await browser.storage.local.get('Shelf')) as ShelfStorage;
	return stored.Shelf?.connection ?? null;
}

async function readSettings(): Promise<ExtensionSettings> {
	const [notifications, infobox, podcasts, recognized, percent] = await Promise.all([
		Options.getOption(Options.USE_NOTIFICATIONS),
		Options.getOption(Options.USE_INFOBOX),
		Options.getOption(Options.SCROBBLE_PODCASTS),
		Options.getOption(Options.SCROBBLE_RECOGNIZED_TRACKS),
		Options.getOption(Options.SCROBBLE_PERCENT),
	]);
	return {
		[Options.USE_NOTIFICATIONS]: notifications !== false,
		[Options.USE_INFOBOX]: infobox !== false,
		[Options.SCROBBLE_PODCASTS]: podcasts !== false,
		[Options.SCROBBLE_RECOGNIZED_TRACKS]: recognized !== false,
		[Options.SCROBBLE_PERCENT]: typeof percent === 'number' ? percent : 50,
	};
}

/** MISC5に必要な接続・同期・表示設定だけを持つ通常の設定画面。 */
function Settings() {
	const [connection] = createResource(readConnection);
	const [settings, { refetch: refetchSettings }] = createResource(readSettings);
	const shelfUrl = () => connection()?.origin || SHELF_ORIGIN;
	const version = browser.runtime.getManifest().version;

	const updateBoolean = (key: BooleanSetting, value: boolean) => {
		void Options.setOption(key, value).then(() => refetchSettings());
	};
	const updatePercent = (value: number) => {
		void Options.setOption(Options.SCROBBLE_PERCENT, value).then(() =>
			refetchSettings(),
		);
	};

	return (
		<main class={styles.page}>
			<header class={styles.header}>
				<div>
					<p class={styles.kicker}>MISC5 / EXTENSION SETTINGS</p>
					<h1>棚の設定</h1>
				</div>
				<p class={styles.version}>BUILD {version}</p>
			</header>

			<div class={styles.layout}>
				<section class={styles.section}>
					<div class={styles.sectionHeading}>
						<span class={styles.signal} aria-hidden="true" />
						<p>01 / CONNECTION</p>
					</div>
					<h2>アカウント連携</h2>
					<Show when={!connection.loading} fallback={<p class={styles.copy}>接続状態を確認中です。</p>}>
						<Show
							when={connection()}
							fallback={<p class={styles.copy}>未接続です。棚アプリへログインして「SHELF CONNECT」を押してください。</p>}
						>
							<p class={styles.account}>CONNECTED / {connection()?.account}</p>
							<p class={styles.copy}>アカウントを変更するまで、再生履歴は自動で棚へ同期されます。</p>
						</Show>
					</Show>
				</section>

				<section class={styles.section}>
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
					<p class={styles.copy}>この割合まで再生すると、履歴を棚へ確定保存します。</p>
				</section>

				<section class={`${styles.section} ${styles.wide}`}>
					<div class={styles.sectionHeading}>
						<span class={styles.signal} aria-hidden="true" />
						<p>03 / PLAYBACK</p>
					</div>
					<h2>再生と表示</h2>
					<div class={styles.toggleList}>
						<For each={toggles}>
							{(toggle) => (
								<label class={styles.toggleRow}>
									<span>
										<strong>{toggle.label}</strong>
										<small>{toggle.detail}</small>
									</span>
									<input
										type="checkbox"
										checked={settings()?.[toggle.key] ?? false}
										onInput={(event) => updateBoolean(toggle.key, event.currentTarget.checked)}
									/>
									<i aria-hidden="true" />
								</label>
							)}
						</For>
					</div>
				</section>
			</div>

			<a class={styles.cta} href={shelfUrl()} target="_blank" rel="noreferrer">
				棚アプリを開く ↗
			</a>
		</main>
	);
}

const root = document.getElementById('root');
if (!root) {
	throw new Error('Root element not found');
}
render(Settings, root);

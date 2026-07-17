import { createResource, Match, Switch } from 'solid-js';
import browser from 'webextension-polyfill';
import { SettingsOutlined } from '@/ui/components/icons';
import { PopupAnchor } from '../components/util';
import styles from './err.module.scss';

type ShelfConnection = { account: string };
type ShelfStorage = { Shelf?: { connection?: ShelfConnection } };

async function readConnection(): Promise<ShelfConnection | null> {
	const stored = (await browser.storage.local.get('Shelf')) as ShelfStorage;
	return stored.Shelf?.connection ?? null;
}

/**
 * Shown when a scrobble/now-playing request didn't succeed. Web Scrobbler's stock
 * generic "Service error" reads like the extension itself is broken, but by far the
 * most common cause here is simply that this browser hasn't connected to the Shelf
 * yet (scrobble-service.ts short-circuits every song to ERROR_AUTH when no scrobbler
 * is bound) — so surface that distinctly from a genuine mid-sync failure instead of
 * one generic label.
 */
export default function Err() {
	const [connection] = createResource(readConnection);
	const status = () => {
		if (connection.loading) return 'loading';
		return connection() ? 'error' : 'disconnected';
	};

	return (
		<div class={styles.card}>
			<p class={styles.meta}>
				<span class={styles.dot} aria-hidden="true" />
				<span class={styles.kicker}>
					<Switch>
						<Match when={status() === 'loading'}>SHELF / CHECKING</Match>
						<Match when={status() === 'disconnected'}>SHELF / NOT CONNECTED</Match>
						<Match when={status() === 'error'}>SHELF / SYNC ERROR</Match>
					</Switch>
				</span>
			</p>
			<Switch>
				<Match when={status() === 'loading'}>
					<h1 class={styles.headline}>確認中…</h1>
				</Match>
				<Match when={status() === 'disconnected'}>
					<h1 class={styles.headline}>未同期です</h1>
					<p class={styles.copy}>
						この端末はまだシェルフに接続されていません。曲は認識されていますが、送信先がないため履歴は保存されていません。
					</p>
					<PopupAnchor
						href={browser.runtime.getURL(
							'src/ui/options/index.html#connection',
						)}
						class={styles.action}
					>
						<SettingsOutlined />
						接続する
					</PopupAnchor>
				</Match>
				<Match when={status() === 'error'}>
					<h1 class={styles.headline}>同期に失敗</h1>
					<p class={styles.copy}>
						シェルフへの送信中にエラーが発生しました。しばらくすると自動で再試行されます。改善しない場合はネットワークやシェルフ側の状態を確認してください。
					</p>
					<PopupAnchor
						href={browser.runtime.getURL(
							'src/ui/options/index.html#connection',
						)}
						class={styles.action}
					>
						<SettingsOutlined />
						設定を開く
					</PopupAnchor>
				</Match>
			</Switch>
		</div>
	);
}

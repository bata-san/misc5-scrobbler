import { sendContentMessage } from '@/util/communication';
import type { ShelfConnectionRequest } from '@/core/scrobbler/shelf-scrobbler';

const BRIDGE = 'misc5-shelf-extension';
const PRODUCTION_SHELF_ORIGIN = 'https://misc5-shelf.butter3.workers.dev';

type BridgeMessage = {
	source?: string;
	type?: 'ping' | 'connect' | 'connection-code';
	origin?: string;
	code?: string;
	state?: string;
};

function reply(type: 'ready' | 'connected' | 'connect-failed', message?: string) {
	window.postMessage({ source: BRIDGE, type, message }, window.location.origin);
}

// 拡張機能が更新/再読み込みされると、既に開いていたタブのcontent scriptは
// バックグラウンドとの接続が切れ、runtime.sendMessageが
// "Extension context invalidated." という生の英語エラーを投げる。原因はページの古さ
// であって接続自体の失敗ではないので、そのまま出さずに再読み込みを促す文言に変換する。
function friendlyMessage(error: unknown): string {
	const raw = error instanceof Error ? error.message : '';
	if (/context invalidated/i.test(raw)) {
		return '拡張機能が更新されました。このページを再読み込みしてから、もう一度お試しください。';
	}
	return raw || '接続できませんでした。';
}

function replyConnectionRequest(request: ShelfConnectionRequest) {
	window.postMessage(
		{ source: BRIDGE, type: 'connection-request', ...request },
		window.location.origin,
	);
}

function isTrustedShelfOrigin(origin: string): boolean {
	try {
		const url = new URL(origin);
		return (
			url.origin === PRODUCTION_SHELF_ORIGIN ||
			(url.protocol === 'http:' &&
				(url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
		);
	} catch {
		return false;
	}
}

// シェルフのWebページだけが呼ぶ接続ブリッジ。PKCE verifierはbackgroundに残したまま、
// ページには認可コードの発行・返却だけを任せる。
export function setupShelfBridge() {
	window.addEventListener('message', (event: MessageEvent<BridgeMessage>) => {
		if (
			event.source !== window ||
			event.origin !== window.location.origin ||
			event.data?.source !== BRIDGE ||
			!isTrustedShelfOrigin(window.location.origin)
		) {
			return;
		}
		if (event.data.type === 'ping') {
			reply('ready');
			return;
		}
		if (event.data.type === 'connect' && event.data.origin === window.location.origin) {
			void sendContentMessage({
				type: 'shelfStartConnection',
				payload: { origin: window.location.origin },
			})
			.then(replyConnectionRequest)
			.catch((error: unknown) => {
				reply('connect-failed', friendlyMessage(error));
			});
			return;
		}
		if (
			event.data.type !== 'connection-code' ||
			event.data.origin !== window.location.origin ||
			!event.data.code ||
			!event.data.state
		) {
			return;
		}
		void sendContentMessage({
			type: 'shelfFinishConnection',
			payload: {
				origin: window.location.origin,
				code: event.data.code,
				state: event.data.state,
			},
		})
			.then(() => reply('connected'))
			.catch((error: unknown) => {
				reply('connect-failed', friendlyMessage(error));
			});
	});
}

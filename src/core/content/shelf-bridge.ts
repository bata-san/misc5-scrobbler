import { sendContentMessage } from '@/util/communication';

const BRIDGE = 'misc5-shelf-extension';

type BridgeMessage = {
	source?: string;
	type?: 'ping' | 'connect';
	origin?: string;
};

function reply(type: 'ready' | 'connected' | 'connect-failed', message?: string) {
	window.postMessage({ source: BRIDGE, type, message }, window.location.origin);
}

// 棚のWebページだけが呼ぶ接続ブリッジ。拡張設定にURLを入力させない。
export function setupShelfBridge() {
	window.addEventListener('message', (event: MessageEvent<BridgeMessage>) => {
		if (event.source !== window || event.data?.source !== BRIDGE) return;
		if (event.data.type === 'ping') {
			reply('ready');
			return;
		}
		if (event.data.type !== 'connect' || event.data.origin !== window.location.origin) return;
		void sendContentMessage({ type: 'shelfConnect', payload: { origin: window.location.origin } })
			.then(() => reply('connected'))
			.catch((error: unknown) => {
				const message = error instanceof Error ? error.message : '接続できませんでした。';
				reply('connect-failed', message);
			});
	});
}

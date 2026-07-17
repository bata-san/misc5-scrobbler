'use strict';

import type { BaseSong } from '@/core/object/song';
import type ClonedSong from '@/core/object/cloned-song';
import { ServiceCallResult } from '@/core/object/service-call-result';
import BaseScrobbler, { type SessionData } from '@/core/scrobbler/base-scrobbler';
import browser from 'webextension-polyfill';

type ShelfRequest = {
	eventName: 'nowplaying' | 'scrobble';
	time: number;
	data: {
		song: BaseSong;
		songs?: BaseSong[];
		currentlyPlaying?: boolean;
	};
};

type ShelfConnection = {
	origin: string;
	account: string;
	deviceId: string;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
};

type TokenResponse = {
	account: string;
	deviceId: string;
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
};

export type ShelfConnectionRequest = {
	origin: string;
	redirectUri: string;
	state: string;
	codeChallenge: string;
};

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function makeVerifier(): string {
	return toBase64Url(crypto.getRandomValues(new Uint8Array(48)));
}

async function makeChallenge(verifier: string): Promise<string> {
	return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

function normalizeOrigin(value: string): string {
	const url = new URL(value);
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
		throw new Error('安全なシェルフURLではありません。');
	}
	return url.origin;
}

/** シェルフへ送信するscrobbler。ユーザーがURLやWebhookを設定する必要はない。 */
export default class ShelfScrobbler extends BaseScrobbler<'Shelf'> {
	public isLocalOnly = true;

	protected getBaseProfileUrl(): string {
		return '';
	}

	getLabel(): 'Shelf' {
		return 'Shelf';
	}

	getStatusUrl(): string {
		return '';
	}

	protected getStorageName(): 'Shelf' {
		return 'Shelf';
	}

	async getSession(): Promise<SessionData> {
		const connection = await this.getConnection();
		if (!connection) return Promise.reject(new Error('シェルフが未接続です。'));
		return { sessionID: connection.deviceId, sessionName: connection.account };
	}

	getAuthUrl(): Promise<string> {
		return Promise.resolve('');
	}

	async isReadyForGrantAccess(): Promise<boolean> {
		return !!(await this.getConnection());
	}

	async getProfileUrl(): Promise<string> {
		return Promise.resolve('');
	}

	async getSongInfo(_song: BaseSong): Promise<Record<string, never>> {
		return {};
	}

	// 認可ポップアップを開かず、ログイン済みのシェルフページへPKCE情報だけを渡す。
	// verifierは拡張ストレージにだけ置くため、ページが一回限りのcodeを見てもtokenは交換できない。
	async startConnection(originValue: string): Promise<ShelfConnectionRequest> {
		const origin = normalizeOrigin(originValue);
		const redirectUri = browser.identity.getRedirectURL('misc5-shelf');
		const verifier = makeVerifier();
		const state = makeVerifier();
		const codeChallenge = await makeChallenge(verifier);
		const stored = await this.storage.get();
		await this.storage.set({
			...(stored ?? {}),
			pendingAuthorization: {
				origin,
				redirectUri,
				state,
				verifier,
				expiresAt: Date.now() + 2 * 60 * 1000,
			},
		});
		return { origin, redirectUri, state, codeChallenge };
	}

	async finishConnection(originValue: string, code: string, state: string): Promise<void> {
		const origin = normalizeOrigin(originValue);
		const stored = await this.storage.get();
		const pending = stored?.pendingAuthorization;
		if (
			!pending ||
			pending.origin !== origin ||
			pending.state !== state ||
			pending.expiresAt < Date.now()
		) {
			await this.storage.set(
				stored?.connection ? { connection: stored.connection } : {},
			);
			throw new Error('接続の有効期限が切れました。もう一度、同期を許可してください。');
		}
		const tokens = await this.requestTokens(origin, {
			grant_type: 'authorization_code',
			code,
			code_verifier: pending.verifier,
			redirect_uri: pending.redirectUri,
		});
		await this.saveTokens(origin, tokens);
	}

	async signOut(): Promise<void> {
		const connection = await this.getConnection();
		if (connection) {
			await fetch(new URL('/api/extension/disconnect', connection.origin), {
				method: 'POST',
				headers: { Authorization: `Bearer ${connection.accessToken}` },
			}).catch(() => undefined);
		}
		await this.storage.set({});
	}

	async sendNowPlaying(song: BaseSong): Promise<ServiceCallResult> {
		return this.sendRequest({ eventName: 'nowplaying', time: Date.now(), data: { song } });
	}

	async sendPaused(_song: BaseSong): Promise<ServiceCallResult> {
		return ServiceCallResult.RESULT_OK;
	}

	async sendResumedPlaying(_song: BaseSong): Promise<ServiceCallResult> {
		return ServiceCallResult.RESULT_OK;
	}

	async scrobble(songs: BaseSong[], currentlyPlaying: boolean): Promise<ServiceCallResult[]> {
		const result = await this.sendRequest({
			eventName: 'scrobble',
			time: Date.now(),
			data: { song: songs[0], songs, currentlyPlaying },
		});
		return new Array<ServiceCallResult>(songs.length).fill(result);
	}

	toggleLove(_song: ClonedSong, _isLoved: boolean): Promise<Record<string, never>> {
		return Promise.resolve({});
	}

	private async getConnection(): Promise<ShelfConnection | null> {
		const stored = await this.storage.get();
		return stored?.connection ?? null;
	}

	private async saveTokens(origin: string, tokens: TokenResponse): Promise<void> {
		await this.storage.set({
			connection: {
				origin,
				account: tokens.account,
				deviceId: tokens.deviceId,
				accessToken: tokens.accessToken,
				refreshToken: tokens.refreshToken,
				expiresAt: Date.now() + tokens.expiresIn * 1000,
			},
		});
	}

	private async requestTokens(origin: string, body: Record<string, string>): Promise<TokenResponse> {
		const response = await fetch(new URL('/api/extension/token', origin), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		if (!response.ok) {
			const detail = (await response.text()).slice(0, 160);
			this.debugLog(`Token request failed (${response.status}): ${detail}`, 'error');
			throw new Error('シェルフへの接続に失敗しました。もう一度、同期を許可してください。');
		}
		return (await response.json()) as TokenResponse;
	}

	private async refresh(connection: ShelfConnection): Promise<ShelfConnection> {
		const tokens = await this.requestTokens(connection.origin, {
			grant_type: 'refresh_token',
			refresh_token: connection.refreshToken,
		});
		await this.saveTokens(connection.origin, tokens);
		return {
			origin: connection.origin,
			account: tokens.account,
			deviceId: tokens.deviceId,
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken,
			expiresAt: Date.now() + tokens.expiresIn * 1000,
		};
	}

	private async sendRequest(request: ShelfRequest): Promise<ServiceCallResult> {
		let connection = await this.getConnection();
		if (!connection) return ServiceCallResult.ERROR_AUTH;
		try {
			if (connection.expiresAt <= Date.now() + 30_000) connection = await this.refresh(connection);
			let response = await this.postEvent(connection, request);
			if (response.status === 401) {
				connection = await this.refresh(connection);
				response = await this.postEvent(connection, request);
			}
			if (response.ok) return ServiceCallResult.RESULT_OK;
			this.debugLog(`Event request failed (${response.status})`, 'error');
			return response.status === 401 ? ServiceCallResult.ERROR_AUTH : ServiceCallResult.ERROR_OTHER;
		} catch (error) {
			this.debugLog(`Event request failed: ${String(error)}`, 'error');
			return ServiceCallResult.ERROR_OTHER;
		}
	}

	private postEvent(connection: ShelfConnection, request: ShelfRequest): Promise<Response> {
		// 送信先は従来のWeb Scrobbler webhook URL。端末bearerを添えることで、ログインした
		// アカウントだけへ安全に書き込みつつ、既存のWebhook payload互換を維持する。
		return fetch(new URL('/api/scrobble', connection.origin), {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${connection.accessToken}`,
				'Content-Type': 'application/json',
				'X-MISC5-Extension': '1',
			},
			body: JSON.stringify(request),
		});
	}
}

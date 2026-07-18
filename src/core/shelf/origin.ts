const LOCAL_SHELF_ORIGINS = new Set([
	'http://localhost:3000',
	'http://127.0.0.1:3000',
]);

// These are the public, production origins. Do not accept arbitrary HTTPS
// origins here: the bridge exchanges an authorization code with this site.
// `misc5.unitze.net` is the user-facing custom domain; the Workers URL
// remains supported for existing installs and direct deployments.
export const SHELF_APP_ORIGIN = 'https://misc5-shelf.im-super-yuanchan.workers.dev';
export const SHELF_CUSTOM_ORIGIN = 'https://misc5.unitze.net';
const SHELF_APP_ORIGINS = new Set([
	SHELF_APP_ORIGIN,
	SHELF_CUSTOM_ORIGIN,
]);

// Tokens from the previous Worker deployment were copied to the quon D1
// database. Retain only this one legacy value long enough to upgrade stored
// connections; new bridge activity is always pinned to SHELF_APP_ORIGIN.
const LEGACY_SHELF_ORIGINS = new Set([
	'https://misc5-shelf.butter3.workers.dev',
]);

export const SHELF_APP_MATCHES = Array.from(SHELF_APP_ORIGINS, (origin) => `${origin}/*`);
export const SHELF_PRIVACY_POLICY_URL = new URL('/privacy', SHELF_APP_ORIGIN).toString();

function toOrigin(value: string): string {
	return new URL(value).origin;
}

export function isShelfAppOrigin(value: string): boolean {
	try {
		return SHELF_APP_ORIGINS.has(toOrigin(value));
	} catch {
		return false;
	}
}

export function isShelfBridgeOrigin(value: string): boolean {
	try {
		const origin = toOrigin(value);
		return SHELF_APP_ORIGINS.has(origin) || LOCAL_SHELF_ORIGINS.has(origin);
	} catch {
		return false;
	}
}

/**
 * Normalizes a persisted extension connection to the current Worker origin.
 * It deliberately accepts neither arbitrary HTTPS origins nor the old origin
 * for new bridge interactions, preventing a page from redirecting tokens.
 */
export function normalizeShelfOrigin(value: string): string {
	const origin = toOrigin(value);
	if (SHELF_APP_ORIGINS.has(origin) || LOCAL_SHELF_ORIGINS.has(origin)) return origin;
	if (LEGACY_SHELF_ORIGINS.has(origin)) return SHELF_APP_ORIGIN;
	throw new Error('安全なシェルフURLではありません。');
}

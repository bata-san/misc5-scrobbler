import { createResource, Match, Switch } from 'solid-js';
import browser from 'webextension-polyfill';
import { sendContentMessage } from '@/util/communication';
import { t } from '@/util/i18n';
import { SentimentDissatisfiedOutlined } from '@/ui/components/icons';
import styles from './popup.module.scss';
import { PopupAnchor } from '../components/util';
import { isShelfAppOrigin } from '@/core/shelf/origin';

async function isShelfActiveTab(): Promise<boolean> {
	const [tab] = await browser.tabs.query({
		active: true,
		lastFocusedWindow: true,
	});
	return isShelfAppOrigin(tab?.url ?? '');
}

/**
 * Info to show when the user is on a website not supported by web scrobbler
 */
export default function Unsupported() {
	const [isShelf] = createResource(isShelfActiveTab);
	const activateShelfBridge = () => {
		void sendContentMessage({
			type: 'activateShelfBridge',
			payload: undefined,
		}).finally(() => window.close());
	};

	return (
		<Switch>
			<Match when={isShelf()}>
				<div class={`${styles.alertPopup} ${styles.shelfPopup}`}>
					<p class={styles.shelfMeta}>MISC5 / SHELF</p>
					<h1>シェルフと連携</h1>
					<p>
						このページでは音楽を再生しませんが、MISC5アカウントとの同期を設定できます。
					</p>
					<button class={styles.shelfAction} type="button" onClick={activateShelfBridge}>
						このページで同期を設定する
					</button>
				</div>
			</Match>
			<Match when={!isShelf.loading}>
				<div class={styles.alertPopup}>
					<SentimentDissatisfiedOutlined class={styles.bigIcon} />
					<h1>{t('unsupportedWebsiteHeader')}</h1>
					<p>{t('unsupportedWebsiteDesc')}</p>
					<p>{t('unsupportedWebsiteUpdateNote')}</p>
					<p>
						<span>{t('unsupportedWebsiteDesc2')} </span>
						<PopupAnchor href="https://cloud.google.com/docs/chrome-enterprise/policies/?policy=ExtensionSettings">
							{t('learnMoreLabel')}
						</PopupAnchor>
					</p>
				</div>
			</Match>
		</Switch>
	);
}

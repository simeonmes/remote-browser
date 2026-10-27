import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Browser, Page, CDPSession } from 'playwright';
import type {
  BrowserInput,
  BrowserSession,
  NavigationAction,
  Viewport,
} from '@remote-browser/shared';
import { AppError } from '../errors.js';
import { validateNavigationUrl } from '../url-policy.js';
import { SafeFetcher, type Resource, type ResourceFetcher } from './safe-fetch.js';
import { startDenyProxy } from './deny-proxy.js';
import { startEgressProxy } from './egress-proxy.js';

export type EngineOptions = {
  mode?: 'public' | 'allowlist';
  domains: string[];
  homeUrl: string;
  channel: 'chromium' | 'chrome' | 'msedge';
};
export type Frame = {
  bytes: Buffer;
  etag: string;
  revision: number;
  width: number;
  height: number;
};
export interface BrowserEngine {
  status(): BrowserSession | null;
  start(viewport: Viewport): Promise<BrowserSession>;
  navigate(id: string, url: string): Promise<BrowserSession>;
  frame(id: string): Promise<Frame>;
  stop(id?: string): Promise<void>;
  input(id: string, input: BrowserInput): Promise<BrowserSession>;
  resize(id: string, viewport: Viewport): Promise<BrowserSession>;
  history(id: string, action: NavigationAction): Promise<BrowserSession>;
  releaseInput(): Promise<void>;
}

/** One ephemeral Chromium session using either guarded public networking or a restricted fetcher. */
export class PlaywrightEngine implements BrowserEngine {
  private browser: Browser | undefined;
  private page: Page | undefined;
  private inputChannel: CDPSession | undefined;
  private pointer = { x: 0, y: 0 };
  private guard: Awaited<ReturnType<typeof startDenyProxy>> | undefined;
  private session: BrowserSession | null = null;
  private operation = false;
  private generation = 0;
  private controller = new AbortController();
  private inFlightResources = 0;
  private resourceCount = 0;
  private resourceBytes = 0;
  private capture: Promise<Frame> | undefined;
  private cached: (Frame & { at: number }) | undefined;
  private blockedNavigation: string | undefined;
  private documentResource: { url: string; resource: Resource } | undefined;
  private readonly fetcher: ResourceFetcher;
  private historyUrls: string[] = [];
  private historyIndex = -1;
  private pendingNavigation: string | undefined;
  private pressedButtons = new Set<'left' | 'middle' | 'right'>();
  private adoptingPopup = false;

  constructor(
    private readonly options: EngineOptions,
    fetcher?: ResourceFetcher,
    private readonly proxyFactory = startEgressProxy,
  ) {
    this.fetcher = fetcher ?? new SafeFetcher(options.domains);
  }

  status(): BrowserSession | null {
    return this.session ? structuredClone(this.session) : null;
  }

  async start(viewport: Viewport): Promise<BrowserSession> {
    if (this.operation || this.session)
      throw new AppError(
        409,
        'SESSION_EXISTS',
        'Stop the existing browser before starting another.',
      );
    this.operation = true;
    const generation = ++this.generation;
    const startupDeadline = setTimeout(() => {
      if (this.generation === generation) void this.stop();
    }, 40_000);
    startupDeadline.unref();
    this.controller = new AbortController();
    this.resourceCount = 0;
    this.inFlightResources = 0;
    this.resourceBytes = 0;
    this.adoptingPopup = false;
    this.historyUrls = [];
    this.historyIndex = -1;
    this.session = {
      id: randomUUID(),
      state: 'starting',
      url: '',
      title: '',
      viewport,
      error: null,
      revision: 0,
      canGoBack: false,
      canGoForward: false,
    };
    try {
      process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(
        new URL('../../../.playwright', import.meta.url),
      );
      const { chromium } = await import('playwright');
      const guard = await (this.options.mode === 'public' ? this.proxyFactory() : startDenyProxy());
      if (generation !== this.generation) {
        await guard.close();
        throw new Error('Cancelled');
      }
      this.guard = guard;
      const browser = await chromium.launch({
        headless: true,
        chromiumSandbox: true,
        timeout: 20_000,
        ...(this.options.channel !== 'chromium' ? { channel: this.options.channel } : {}),
        proxy: { server: guard.url, bypass: '<-loopback>' },
        args: ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
      });
      if (generation !== this.generation) {
        await browser.close();
        throw new Error('Cancelled');
      }
      this.browser = browser;
      browser.on('disconnected', () => {
        if (this.browser === browser)
          void this.fail('Chromium disconnected. Stop this session and start again.');
      });
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        javaScriptEnabled: this.options.mode === 'public',
        serviceWorkers: 'block',
        acceptDownloads: false,
        permissions: [],
      });
      if (generation !== this.generation) {
        await context.close();
        throw new Error('Cancelled');
      }
      context.setDefaultTimeout(5000);
      if (this.options.mode !== 'public')
        await context.routeWebSocket('**/*', (route) => route.close());
      const controller = this.controller;
      if (this.options.mode === 'public') {
        await context.route('**/*', async (route) => {
          try {
            validateNavigationUrl(route.request().url(), [], 'public');
            await route.continue();
          } catch {
            await route.abort('blockedbyclient').catch(() => {});
          }
        });
      } else
        await context.route('**/*', async (route) => {
          const request = route.request();
          let counted = false;
          try {
            validateNavigationUrl(request.url(), this.options.domains);
            if (
              request.method() !== 'GET' ||
              !['document', 'stylesheet', 'image', 'font'].includes(request.resourceType())
            )
              throw new Error('Only read-only document resources are supported.');
            if (
              generation !== this.generation ||
              this.inFlightResources >= 16 ||
              ++this.resourceCount > 500 ||
              this.resourceBytes > 25 * 1024 * 1024
            )
              throw new Error('The browser resource limit was reached.');
            this.inFlightResources++;
            counted = true;
            const prepared =
              this.documentResource?.url === request.url() &&
              request.isNavigationRequest() &&
              request.frame() === this.page?.mainFrame()
                ? this.documentResource
                : undefined;
            if (prepared) this.documentResource = undefined;
            if (
              !prepared &&
              request.isNavigationRequest() &&
              request.frame() === this.page?.mainFrame()
            ) {
              // Native links and GET forms re-enter our explicit redirect-validation path.
              this.pendingNavigation = request.url();
              await route.abort('aborted');
              if (!this.operation) void this.drainNavigation();
              return;
            }
            const resource =
              prepared?.resource ?? (await this.fetcher.fetch(request.url(), controller.signal));
            if (generation !== this.generation) throw new Error('Session stopped.');
            if (!prepared) this.resourceBytes += resource.body.length;
            if (generation !== this.generation || this.resourceBytes > 25 * 1024 * 1024)
              throw new Error('Session stopped or resource budget exceeded.');
            if (resource.headers.location)
              validateNavigationUrl(
                new URL(resource.headers.location, request.url()).href,
                this.options.domains,
              );
            // Playwright does not re-route every redirect hop. Never pass a redirect through
            // to Chromium; document redirects are resolved before goto, below.
            if (resource.status >= 300 && resource.status < 400)
              throw new Error('Redirecting subresources are not supported in this phase.');
            await route.fulfill(resource);
          } catch (error) {
            if (
              generation === this.generation &&
              request.isNavigationRequest() &&
              request.frame() === this.page?.mainFrame()
            ) {
              this.blockedNavigation =
                error instanceof AppError
                  ? error.message
                  : 'The page could not be loaded under the test browsing policy.';
              if (this.session) this.session.error = this.blockedNavigation;
            }
            await route.abort('blockedbyclient').catch(() => {});
          } finally {
            if (counted && generation === this.generation) this.inFlightResources--;
          }
        });
      const page = await context.newPage();
      if (generation !== this.generation) {
        await page.close();
        throw new Error('Cancelled');
      }
      this.page = page;
      this.inputChannel = await context.newCDPSession(page);
      if (this.options.mode === 'public') this.watchPublicPage(page, generation);
      context.on('page', (popup) => {
        if (popup === this.page) return;
        if (this.options.mode === 'public' && !this.adoptingPopup) {
          this.adoptingPopup = true;
          void this.adoptPopup(popup, generation).finally(() => {
            if (generation === this.generation) this.adoptingPopup = false;
          });
        } else void popup.close().catch(() => {});
      });
      page.on('crash', () => {
        if (this.page === page)
          void this.fail('The Chromium page crashed. Stop this session and start again.');
      });
      page.on('dialog', (dialog) => {
        void dialog.dismiss().catch(() => {});
      });
      page.on('download', (download) => {
        void download.cancel().catch(() => {});
      });
      return await this.load(this.options.homeUrl, generation);
    } catch (error) {
      if (generation === this.generation) await this.stop();
      if (error instanceof AppError) throw error;
      throw new AppError(
        503,
        'BROWSER_START_FAILED',
        'Chromium could not start. Run npm run browser:install, then try again.',
        { cause: error },
      );
    } finally {
      clearTimeout(startupDeadline);
      this.operation = false;
      void this.drainNavigation();
    }
  }

  async navigate(id: string, value: string): Promise<BrowserSession> {
    this.requireSession(id);
    validateNavigationUrl(value, this.options.domains, this.options.mode);
    if (this.operation)
      throw new AppError(409, 'BROWSER_BUSY', 'Wait for the current browser operation to finish.');
    this.operation = true;
    try {
      return await this.load(value, this.generation);
    } finally {
      this.operation = false;
      void this.drainNavigation();
    }
  }

  private async load(
    value: string,
    generation: number,
    history: 'push' | 'replace' | number = 'push',
  ): Promise<BrowserSession> {
    if (this.options.mode === 'public') return this.loadPublic(value, generation);
    const page = this.page;
    if (!page || !this.session)
      throw new AppError(409, 'BROWSER_UNAVAILABLE', 'Start a browser session first.');
    this.session.state = 'loading';
    this.session.error = null;
    this.blockedNavigation = undefined;
    this.cached = undefined;
    this.session.revision++;
    try {
      let target = validateNavigationUrl(value, this.options.domains).href;
      const deadline = AbortSignal.any([this.controller.signal, AbortSignal.timeout(15_000)]);
      for (let hop = 0; ; hop++) {
        if (hop > 5 || ++this.resourceCount > 500)
          throw new AppError(
            502,
            'REDIRECT_LIMIT',
            'The page exceeded the redirect or request limit.',
          );
        const resource = await this.fetcher.fetch(target, deadline);
        if (generation !== this.generation) throw new Error('Cancelled');
        this.resourceBytes += resource.body.length;
        if (this.resourceBytes > 25 * 1024 * 1024)
          throw new AppError(
            413,
            'RESOURCE_LIMIT',
            'The session reached its resource budget. Stop and start a new browser.',
          );
        if ([301, 302, 303, 307, 308].includes(resource.status) && resource.headers.location) {
          target = validateNavigationUrl(
            new URL(resource.headers.location, target).href,
            this.options.domains,
          ).href;
          continue;
        }
        const resourceUrl = new URL(target);
        resourceUrl.hash = '';
        this.documentResource = { url: resourceUrl.href, resource };
        break;
      }
      await page.goto(target, { waitUntil: 'load', timeout: 20_000 });
      if (generation !== this.generation || !this.session) throw new Error('Cancelled');
      this.session.url = page.url();
      const title = (await page.title()).slice(0, 200);
      if (generation !== this.generation || !this.session) throw new Error('Cancelled');
      this.session.title = title;
      this.session.state = 'ready';
      if (typeof history === 'number') this.historyIndex = history;
      else if (history === 'replace' && this.historyIndex >= 0)
        this.historyUrls[this.historyIndex] = page.url();
      else if (this.historyUrls[this.historyIndex] !== page.url()) {
        this.historyUrls = [...this.historyUrls.slice(0, this.historyIndex + 1), page.url()].slice(
          -100,
        );
        this.historyIndex = this.historyUrls.length - 1;
      }
      this.session.canGoBack = this.historyIndex > 0;
      this.session.canGoForward = this.historyIndex < this.historyUrls.length - 1;
      return this.status()!;
    } catch (error) {
      const message =
        this.blockedNavigation ??
        (error instanceof AppError
          ? error.message
          : 'The page could not load. Check the allowed domain and its availability, then try again.');
      if (generation === this.generation && this.session) {
        this.session.state = 'failed';
        this.session.error = message;
        this.session.url = '';
        this.session.title = '';
      }
      throw new AppError(502, 'NAVIGATION_FAILED', message);
    } finally {
      this.documentResource = undefined;
    }
  }

  async frame(id: string): Promise<Frame> {
    const session = this.requireSession(id);
    if (!this.page || session.state !== 'ready')
      throw new AppError(409, 'FRAME_NOT_READY', 'The browser is loading or unavailable.');
    if (this.cached && Date.now() - this.cached.at < 180) return this.cached;
    if (this.capture) return this.capture;
    const generation = this.generation;
    const revision = session.revision;
    const capture = this.page
      .screenshot({ type: 'jpeg', quality: 65, timeout: 5000, caret: 'hide' })
      .then((bytes) => {
        if (generation !== this.generation)
          throw new AppError(410, 'SESSION_ENDED', 'The browser session ended.');
        if (revision !== this.session?.revision)
          throw new AppError(409, 'STALE_FRAME', 'The viewport changed during capture.');
        const frame = {
          bytes,
          etag: `"${createHash('sha256').update(bytes).digest('hex')}"`,
          at: Date.now(),
          revision,
          width: session.viewport.width,
          height: session.viewport.height,
        };
        this.cached = frame;
        return frame;
      })
      .catch((error) => {
        if (error instanceof AppError) throw error;
        throw new AppError(
          503,
          'CAPTURE_FAILED',
          'The viewport could not be captured. Try again or restart the browser session.',
        );
      })
      .finally(() => {
        if (this.capture === capture) this.capture = undefined;
      });
    this.capture = capture;
    return capture;
  }

  private requireSession(id: string): BrowserSession {
    if (!this.session || this.session.id !== id)
      throw new AppError(404, 'SESSION_NOT_FOUND', 'This browser session no longer exists.');
    return this.session;
  }

  private watchPublicPage(page: Page, generation: number) {
    page.on('framenavigated', (frame) => {
      if (
        frame !== page.mainFrame() ||
        this.page !== page ||
        generation !== this.generation ||
        !this.session
      )
        return;
      this.session.revision++;
      this.cached = undefined;
      this.session.url = page.url();
      this.session.state = 'loading';
      void this.updatePublicPage(page, generation).catch(() => {});
    });
    page.on('domcontentloaded', () => {
      void this.updatePublicPage(page, generation).catch(() => {});
    });
    page.on('load', () => {
      void this.updatePublicPage(page, generation).catch(() => {});
    });
    page.on('requestfailed', (request) => {
      if (
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame() &&
        this.page === page &&
        generation === this.generation &&
        this.session &&
        !this.operation
      ) {
        this.session.error =
          'The website could not load. Its address may be private, blocked, or unavailable.';
        this.session.state = 'failed';
      }
    });
  }

  private async updatePublicPage(page: Page, generation: number) {
    if (this.page !== page || generation !== this.generation || !this.session) return;
    const url = page.url();
    try {
      validateNavigationUrl(url, [], 'public');
    } catch {
      if (url !== 'about:blank' && this.session) {
        this.session.state = 'failed';
        this.session.error = 'The website could not load. Try another address.';
      }
      return;
    }
    const title = (await page.title()).slice(0, 200);
    const history = (await this.inputChannel!.send('Page.getNavigationHistory')) as {
      currentIndex: number;
      entries: { url: string }[];
    };
    if (this.page !== page || generation !== this.generation || !this.session || page.url() !== url)
      return;
    this.session.url = url;
    this.session.title = title;
    this.session.state = 'ready';
    this.session.error = null;
    this.session.canGoBack =
      history.currentIndex > 0 &&
      /^https?:/.test(history.entries[history.currentIndex - 1]?.url ?? '');
    this.session.canGoForward = history.currentIndex < history.entries.length - 1;
  }

  private async adoptPopup(popup: Page, generation: number) {
    try {
      await popup.waitForURL(/^https?:/, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      validateNavigationUrl(popup.url(), [], 'public');
      if (generation !== this.generation || !this.session) {
        await popup.close();
        return;
      }
      const previous = this.page;
      await this.releaseInput();
      const channel = await popup.context().newCDPSession(popup);
      if (generation !== this.generation || !this.session) {
        await popup.close();
        return;
      }
      this.page = popup;
      this.inputChannel = channel;
      this.session.revision++;
      this.cached = undefined;
      this.watchPublicPage(popup, generation);
      popup.on('crash', () => {
        if (this.page === popup)
          void this.fail('Chromium crashed. Stop this session and start again.');
      });
      popup.on('dialog', (dialog) => {
        void dialog.dismiss().catch(() => {});
      });
      popup.on('download', (download) => {
        void download.cancel().catch(() => {});
      });
      await previous?.close().catch(() => {});
      await this.updatePublicPage(popup, generation);
    } catch {
      await popup.close().catch(() => {});
    }
  }

  private async loadPublic(value: string, generation: number): Promise<BrowserSession> {
    const page = this.page;
    if (!page || !this.session)
      throw new AppError(409, 'BROWSER_UNAVAILABLE', 'Start a browser session first.');
    this.session.state = 'loading';
    this.session.error = null;
    this.session.revision++;
    this.cached = undefined;
    try {
      await page.goto(validateNavigationUrl(value, [], 'public').href, {
        waitUntil: 'domcontentloaded',
        timeout: 25_000,
      });
      await this.updatePublicPage(page, generation);
      if (generation !== this.generation || !this.session) throw new Error('Session ended.');
      return this.status()!;
    } catch {
      const message =
        'The website could not load. Check its address and connection. Private-network destinations are blocked.';
      if (generation === this.generation && this.session) {
        this.session.state = 'failed';
        this.session.error = message;
      }
      throw new AppError(502, 'NAVIGATION_FAILED', message);
    }
  }

  private async historyPublic(id: string, action: NavigationAction): Promise<BrowserSession> {
    const page = this.page;
    if (!page) throw new AppError(409, 'BROWSER_UNAVAILABLE', 'Restart the browser session.');
    if (
      (action === 'back' && !this.session?.canGoBack) ||
      (action === 'forward' && !this.session?.canGoForward)
    )
      return this.requireSession(id);
    this.operation = true;
    try {
      if (action === 'home') return await this.loadPublic(this.options.homeUrl, this.generation);
      if (this.session) {
        this.session.state = 'loading';
        this.session.error = null;
        this.session.revision++;
        this.cached = undefined;
      }
      const options = { waitUntil: 'domcontentloaded' as const, timeout: 25_000 };
      if (action === 'back') await page.goBack(options);
      else if (action === 'forward') await page.goForward(options);
      else await page.reload(options);
      await this.updatePublicPage(page, this.generation);
      return this.requireSession(id);
    } catch {
      if (this.session?.id === id) {
        this.session.state = 'failed';
        this.session.error =
          'Navigation did not finish. Try another address or restart the browser.';
      }
      throw new AppError(
        502,
        'NAVIGATION_FAILED',
        'Navigation did not finish. Try another address or restart the browser.',
      );
    } finally {
      this.operation = false;
    }
  }

  private async drainNavigation() {
    if (this.operation || !this.pendingNavigation || !this.session) return;
    const url = this.pendingNavigation;
    this.pendingNavigation = undefined;
    await this.navigate(this.session.id, url).catch(() => {});
  }

  async history(id: string, action: NavigationAction): Promise<BrowserSession> {
    const session = this.requireSession(id);
    if (this.operation) throw new AppError(409, 'BROWSER_BUSY', 'Wait for navigation to finish.');
    if (this.options.mode === 'public') return this.historyPublic(id, action);
    const index = action === 'back' ? this.historyIndex - 1 : this.historyIndex + 1;
    if ((action === 'back' || action === 'forward') && !this.historyUrls[index]) return session;
    this.operation = true;
    try {
      if (action === 'home') return await this.load(this.options.homeUrl, this.generation);
      if (action === 'reload')
        return await this.load(session.url || this.options.homeUrl, this.generation, 'replace');
      return await this.load(this.historyUrls[index]!, this.generation, index);
    } finally {
      this.operation = false;
      void this.drainNavigation();
    }
  }

  async resize(id: string, viewport: Viewport): Promise<BrowserSession> {
    const session = this.requireSession(id);
    if (!this.page || session.state !== 'ready' || this.operation)
      throw new AppError(409, 'BROWSER_BUSY', 'Wait for the browser before resizing.');
    this.operation = true;
    try {
      await this.releaseInput();
      await this.page.setViewportSize(viewport);
      this.requireSession(id);
      session.viewport = viewport;
      session.revision++;
      this.cached = undefined;
      return this.status()!;
    } finally {
      this.operation = false;
      void this.drainNavigation();
    }
  }

  private inputDeadline() {
    const generation = this.generation;
    const timer = setTimeout(() => {
      if (generation === this.generation)
        void this.fail('Chromium stopped responding. Stop this session and start again.');
    }, 6000);
    timer.unref();
    return timer;
  }

  async input(id: string, input: BrowserInput): Promise<BrowserSession> {
    const session = this.requireSession(id);
    const page = this.page;
    if (input.kind === 'release') {
      await this.releaseInput();
      return session;
    }
    if (!page || session.state !== 'ready' || this.operation)
      throw new AppError(409, 'BROWSER_BUSY', 'The page is not ready for input.');
    if (input.revision !== session.revision)
      throw new AppError(409, 'STALE_INPUT', 'Wait for the updated viewport before interacting.');
    if ('x' in input && (input.x >= session.viewport.width || input.y >= session.viewport.height))
      throw new AppError(
        400,
        'INVALID_COORDINATES',
        'Pointer coordinates are outside the viewport.',
      );
    this.operation = true;
    this.cached = undefined;
    const deadline = this.inputDeadline();
    try {
      if (input.kind === 'pointer') {
        this.pointer = { x: input.x, y: input.y };
        if (input.action === 'down') this.pressedButtons.add(input.button);
        if (input.action === 'up') this.pressedButtons.delete(input.button);
        // Playwright's drag detection evaluates page scripts and stalls when JS is disabled.
        // Chromium's documented input protocol preserves native controls without enabling JS.
        await this.inputChannel!.send('Input.dispatchMouseEvent', {
          type:
            input.action === 'move'
              ? 'mouseMoved'
              : input.action === 'down'
                ? 'mousePressed'
                : 'mouseReleased',
          x: input.x,
          y: input.y,
          button: input.action === 'move' ? 'none' : input.button,
          buttons: this.buttonsMask(),
          clickCount: input.action === 'move' ? 0 : 1,
        });
      } else if (input.kind === 'wheel') {
        await this.inputChannel!.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: input.x,
          y: input.y,
          deltaX: input.deltaX,
          deltaY: input.deltaY,
        });
      } else if (input.kind === 'text') await page.keyboard.insertText(input.text);
      else {
        const key =
          input.key === 'SelectAll'
            ? 'Control+A'
            : `${input.control ? 'Control+' : ''}${input.shift ? 'Shift+' : ''}${input.key}`;
        await page.keyboard.press(key);
      }
      return this.requireSession(id);
    } finally {
      clearTimeout(deadline);
      this.operation = false;
      void this.drainNavigation();
    }
  }

  private buttonsMask() {
    return (
      (this.pressedButtons.has('left') ? 1 : 0) |
      (this.pressedButtons.has('right') ? 2 : 0) |
      (this.pressedButtons.has('middle') ? 4 : 0)
    );
  }

  async releaseInput(): Promise<void> {
    const channel = this.inputChannel;
    const buttons = [...this.pressedButtons];
    this.pressedButtons.clear();
    for (const button of buttons)
      await channel
        ?.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          ...this.pointer,
          button,
          buttons: 0,
          clickCount: 1,
        })
        .catch(() => {});
  }

  private async fail(message: string) {
    const previous = this.status();
    const generation = this.generation + 1;
    await this.stop();
    if (previous && !this.session && generation === this.generation)
      this.session = { ...previous, state: 'failed', error: message };
  }

  async stop(id?: string): Promise<void> {
    if (id) this.requireSession(id);
    ++this.generation;
    this.controller.abort();
    this.session = null;
    this.cached = undefined;
    this.capture = undefined;
    this.page = undefined;
    this.inputChannel = undefined;
    this.documentResource = undefined;
    this.pendingNavigation = undefined;
    this.pressedButtons.clear();
    const browser = this.browser;
    const guard = this.guard;
    this.browser = undefined;
    this.guard = undefined;
    await browser?.close().catch(() => {});
    await guard?.close();
  }
}

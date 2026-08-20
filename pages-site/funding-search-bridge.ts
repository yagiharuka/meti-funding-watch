type SearchMessage = {
  type: "search";
  requestId: number;
  parameters: string;
};

type WorkerEnvelope = {
  type?: string;
  requestId?: number;
  result?: unknown;
};

type SearchEventDetail = {
  message: WorkerEnvelope;
  parameters: string | null;
};

const NativeWorker = window.Worker;
const enhancedWorkerUrl = new URL("./funding-search-enhanced.worker.js", import.meta.url);

class FundingSearchWorkerBridge extends EventTarget implements Worker {
  readonly native: Worker;
  readonly enhanced: boolean;
  private pendingSearchParameters = new Map<number, string>();

  onmessage: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
  onmessageerror: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => unknown) | null = null;

  constructor(scriptURL: string | URL, options?: WorkerOptions) {
    super();
    const requested = String(scriptURL);
    this.enhanced = requested.includes("funding-search.worker");
    this.native = new NativeWorker(this.enhanced ? enhancedWorkerUrl : scriptURL, options);

    this.native.addEventListener("message", (event) => {
      const data = event.data as WorkerEnvelope;
      let parameters: string | null = null;
      if (this.enhanced && data?.type === "result" && Number.isSafeInteger(data.requestId)) {
        parameters = this.pendingSearchParameters.get(data.requestId as number) ?? null;
        this.pendingSearchParameters.delete(data.requestId as number);
        window.dispatchEvent(new CustomEvent<SearchEventDetail>("meti-funding-search-result", {
          detail: { message: data, parameters },
        }));
      }
      const forwarded = new MessageEvent("message", {
        data: event.data,
        origin: event.origin,
        lastEventId: event.lastEventId,
        ports: [...event.ports],
        source: event.source,
      });
      this.dispatchEvent(forwarded);
      this.onmessage?.call(this as unknown as Worker, forwarded);
    });

    this.native.addEventListener("messageerror", (event) => {
      const forwarded = new MessageEvent("messageerror", { data: event.data });
      this.dispatchEvent(forwarded);
      this.onmessageerror?.call(this as unknown as Worker, forwarded);
    });

    this.native.addEventListener("error", (event) => {
      const forwarded = new ErrorEvent("error", {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error,
      });
      this.dispatchEvent(forwarded);
      this.onerror?.call(this as unknown as AbstractWorker, forwarded);
    });
  }

  postMessage(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions) {
    if (this.enhanced && message && typeof message === "object") {
      const candidate = message as Partial<SearchMessage>;
      if (candidate.type === "search" && Number.isSafeInteger(candidate.requestId) && typeof candidate.parameters === "string") {
        this.pendingSearchParameters.set(candidate.requestId as number, candidate.parameters);
      }
    }
    if (Array.isArray(transferOrOptions)) {
      this.native.postMessage(message, transferOrOptions);
    } else if (transferOrOptions) {
      this.native.postMessage(message, transferOrOptions);
    } else {
      this.native.postMessage(message);
    }
  }

  terminate() {
    this.pendingSearchParameters.clear();
    this.native.terminate();
  }
}

Object.defineProperty(window, "Worker", {
  configurable: true,
  writable: true,
  value: FundingSearchWorkerBridge,
});

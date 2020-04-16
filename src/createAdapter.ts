/// <reference path="./types/external.d.ts" />

import EventTarget from 'event-target-shim-es5';

import { Adapter, AdapterOptions, AdapterEnhancer, ReadyState } from './types/AdapterTypes';
import createAsyncIterableQueue, { AsyncIterableQueue } from './utils/createAsyncIterableQueue';
import createEvent from './utils/createEvent';

const DEFAULT_ENHANCER: AdapterEnhancer<any> = next => options => next(options);

export default function createAdapter<TActivity>(
  options: AdapterOptions = {},
  enhancer: AdapterEnhancer<TActivity> = DEFAULT_ENHANCER
): Adapter<TActivity> {
  const eventTarget = new EventTarget();
  let ingressQueues: AsyncIterableQueue<TActivity>[] = [];
  let readyStatePropertyValue = ReadyState.CONNECTING;

  const final = enhancer((options: AdapterOptions) => {
    const adapter: Adapter<TActivity> = {
      activities: ({ signal } = {}): AsyncIterable<TActivity> => {
        const queue = createAsyncIterableQueue<TActivity>({ signal });

        ingressQueues.push(queue);

        signal &&
          signal.addEventListener('abort', () => {
            const index = ingressQueues.indexOf(queue);

            ~index || ingressQueues.splice(index, 1);
          });

        return queue.iterable;
      },

      close: () => {
        ingressQueues.forEach(ingressQueue => ingressQueue.end());
        ingressQueues.splice(0, Infinity);
      },

      // Egress middleware API
      egress: (): Promise<void> => {
        return Promise.reject(new Error('There are no enhancers registered for egress().'));
      },

      // Ingress middleware API
      ingress: activity => {
        ingressQueues.forEach(ingressQueue => ingressQueue.push(activity));
      },

      // setReadyState middleware API

      // This field is just a placeholder for TypeScript.
      // It will be replaced with Object.defineProperty below.
      readyState: readyStatePropertyValue,

      setReadyState: (readyState: ReadyState) => {
        if (readyState !== readyStatePropertyValue) {
          if (readyStatePropertyValue === ReadyState.CLOSED) {
            throw new Error('Cannot change "readyState" after it is CLOSED.');
          } else if (
            readyState !== ReadyState.CLOSED &&
            readyState !== ReadyState.CONNECTING &&
            readyState !== ReadyState.OPEN
          ) {
            throw new Error('"readyState" must be either CLOSED, CONNECTING or OPEN.');
          }

          readyStatePropertyValue = readyState;
          eventTarget.dispatchEvent(createEvent(readyState === ReadyState.OPEN ? 'open' : 'error'));
        }
      },

      // EventTarget
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget)
    };

    return adapter;
  })(options);

  if (Object.getPrototypeOf(final) !== Object.prototype) {
    throw new Error('Object returned from enhancer must not be a class object.');
  }

  Object.defineProperty(final, 'readyState', {
    configurable: false,
    enumerable: true,
    get() {
      return readyStatePropertyValue;
    }
  });

  // We should hide setReadyState, it is only available for middleware API.
  delete final.setReadyState;

  return final;
}

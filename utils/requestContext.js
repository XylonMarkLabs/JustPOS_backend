import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

// Runs `next` (or any function) with `store` as the current request context.
// The same object is reused, so later mutations are visible to whoever holds it.
export const runWithContext = (store, fn) => storage.run(store, fn);

export const getContext = () => storage.getStore();

// Merge trusted, server-derived fields (userId, storeId, ...) into the current context.
// Never call this with values taken straight from the request body or query.
export const setContext = (fields) => {
    const store = storage.getStore();
    if (store) Object.assign(store, fields);
};
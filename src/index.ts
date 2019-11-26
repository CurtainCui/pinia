import { ref, watch, computed } from '@vue/composition-api'
import { Ref } from '@vue/composition-api/dist/reactivity'
import {
  StateTree,
  Store,
  SubscriptionCallback,
  DeepPartial,
  isPlainObject,
  StoreGetters,
  StoreGetter,
} from './types'
import { devtoolPlugin } from './devtools'

function innerPatch<T extends StateTree>(
  target: T,
  patchToApply: DeepPartial<T>
): T {
  // TODO: get all keys
  for (const key in patchToApply) {
    const subPatch = patchToApply[key]
    const targetValue = target[key]
    if (isPlainObject(targetValue) && isPlainObject(subPatch)) {
      target[key] = innerPatch(targetValue, subPatch)
    } else {
      // @ts-ignore
      target[key] = subPatch
    }
  }

  return target
}

/**
 * NOTE: by allowing users to name stores correctly, they can nest them the way
 * they want, no? like user/cart
 */

type CombinedStore<
  Id extends string,
  S extends StateTree,
  G extends Record<string, StoreGetter<S>>
> = Store<Id, S> & StoreGetters<S, G>

/**
 * Creates a store instance
 * @param id unique identifier of the store, like a name. eg: main, cart, user
 * @param initialState initial state applied to the store, Must be correctly typed to infer typings
 */

export function createStore<
  Id extends string,
  S extends StateTree,
  G extends Record<string, StoreGetter<S>>
>(
  id: Id,
  buildState: () => S,
  getters: G = {} as G
  // methods: Record<string | symbol, StoreMethod>
): CombinedStore<Id, S, G> {
  const state: Ref<S> = ref(buildState())

  let isListening = true
  let subscriptions: SubscriptionCallback<S>[] = []

  watch(
    () => state.value,
    state => {
      if (isListening) {
        subscriptions.forEach(callback => {
          callback({ storeName: id, type: '🧩 in place', payload: {} }, state)
        })
      }
    },
    {
      deep: true,
      flush: 'sync',
    }
  )

  function patch(partialState: DeepPartial<S>): void {
    isListening = false
    innerPatch(state.value, partialState)
    isListening = true
    subscriptions.forEach(callback => {
      callback(
        { storeName: id, type: '⤵️ patch', payload: partialState },
        state.value
      )
    })
  }

  function subscribe(callback: SubscriptionCallback<S>): void {
    subscriptions.push(callback)
    // TODO: return function to remove subscription
  }

  function reset() {
    subscriptions = []
    state.value = buildState()
  }

  const storeWithState: Store<Id, S> = {
    id,
    // it is replaced below by a getter
    state: state.value,

    patch,
    subscribe,
    reset,
  }

  // @ts-ignore we have to build it
  const computedGetters: StoreGetters<S, G> = {}
  for (const getterName in getters) {
    const method = getters[getterName]
    // @ts-ignore
    computedGetters[getterName] = computed<ReturnType<typeof method>>(() =>
      getters[getterName](state.value)
    )
  }

  const store = {
    ...storeWithState,
    ...computedGetters,
  }

  // make state access invisible
  Object.defineProperty(store, 'state', {
    get: () => state.value,
    set: (newState: S) => {
      isListening = false
      state.value = newState
      isListening = true
    },
  })

  // Devtools injection hue hue
  devtoolPlugin(store)

  return store
}

/**
 * The api needs more work we must be able to use the store easily in any
 * function by calling `useStore` to get the store Instance and we also need to
 * be able to reset the store instance between requests on the server
 */

/**
 *
 * @param id id of the store we are creating
 * @param buildState function that returns a state
 */

export function makeStore<
  Id extends string,
  S extends StateTree,
  G extends Record<string, StoreGetter<S>>
>(id: Id, buildState: () => S, getters: G = {} as G) {
  let store: CombinedStore<Id, S, G> | undefined

  function useStore(): CombinedStore<Id, S, G> {
    if (!store) store = createStore(id, buildState, getters)

    return store
  }

  function clear(): void {
    store = undefined
  }

  return {
    useStore,
    clear,
  }
}

// export const store = createStore('main', initialState)

// type StateI = ReturnType<typeof buildState>
// const buildState = () => ({
//   items: ['thing 1'],
// })
// export const cartStore = createStore('cart', buildState, {
//   amount: state => state.items.length,
// })

// cartStore.nonueo
// cartStore.amount.value * 2

// store.patch({
//   toggle: 'off',
//   nested: {
//     a: {
//       b: {
//         c: 'one',
//       },
//     },
//   },
// })
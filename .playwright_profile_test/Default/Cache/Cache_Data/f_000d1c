import { injectQuery as __vite__injectQuery } from "/@vite/client";/* global window */
/* eslint-disable eqeqeq, prefer-const, @typescript-eslint/no-empty-function */

/*! Copyright (c) Meta Platforms, Inc. and affiliates. **/
/**
 * This is simplified pure-js version of https://github.com/facebook/react/blob/main/packages/react-refresh/src/ReactFreshRuntime.js
 * without IE11 compatibility and verbose isDev checks.
 * Some utils are appended at the bottom for HMR integration.
 */

const REACT_FORWARD_REF_TYPE = Symbol.for('react.forward_ref')
const REACT_MEMO_TYPE = Symbol.for('react.memo')

// We never remove these associations.
// It's OK to reference families, but use WeakMap/Set for types.
let allFamiliesByID = new Map()
let allFamiliesByType = new WeakMap()
let allSignaturesByType = new WeakMap()

// This WeakMap is read by React, so we only put families
// that have actually been edited here. This keeps checks fast.
const updatedFamiliesByType = new WeakMap()

// This is cleared on every performReactRefresh() call.
// It is an array of [Family, NextType] tuples.
let pendingUpdates = []

// This is injected by the renderer via DevTools global hook.
const helpersByRendererID = new Map()

const helpersByRoot = new Map()

// We keep track of mounted roots so we can schedule updates.
const mountedRoots = new Set()
// If a root captures an error, we remember it so we can retry on edit.
const failedRoots = new Set()

// We also remember the last element for every root.
// It needs to be weak because we do this even for roots that failed to mount.
// If there is no WeakMap, we won't attempt to do retrying.
let rootElements = new WeakMap()
let isPerformingRefresh = false

function computeFullKey(signature) {
  if (signature.fullKey !== null) {
    return signature.fullKey
  }

  let fullKey = signature.ownKey
  let hooks
  try {
    hooks = signature.getCustomHooks()
  } catch (err) {
    // This can happen in an edge case, e.g. if expression like Foo.useSomething
    // depends on Foo which is lazily initialized during rendering.
    // In that case just assume we'll have to remount.
    signature.forceReset = true
    signature.fullKey = fullKey
    return fullKey
  }

  for (let i = 0; i < hooks.length; i++) {
    const hook = hooks[i]
    if (typeof hook !== 'function') {
      // Something's wrong. Assume we need to remount.
      signature.forceReset = true
      signature.fullKey = fullKey
      return fullKey
    }
    const nestedHookSignature = allSignaturesByType.get(hook)
    if (nestedHookSignature === undefined) {
      // No signature means Hook wasn't in the source code, e.g. in a library.
      // We'll skip it because we can assume it won't change during this session.
      continue
    }
    const nestedHookKey = computeFullKey(nestedHookSignature)
    if (nestedHookSignature.forceReset) {
      signature.forceReset = true
    }
    fullKey += '\n---\n' + nestedHookKey
  }

  signature.fullKey = fullKey
  return fullKey
}

function haveEqualSignatures(prevType, nextType) {
  const prevSignature = allSignaturesByType.get(prevType)
  const nextSignature = allSignaturesByType.get(nextType)

  if (prevSignature === undefined && nextSignature === undefined) {
    return true
  }
  if (prevSignature === undefined || nextSignature === undefined) {
    return false
  }
  if (computeFullKey(prevSignature) !== computeFullKey(nextSignature)) {
    return false
  }
  if (nextSignature.forceReset) {
    return false
  }

  return true
}

function isReactClass(type) {
  return type.prototype && type.prototype.isReactComponent
}

function canPreserveStateBetween(prevType, nextType) {
  if (isReactClass(prevType) || isReactClass(nextType)) {
    return false
  }
  if (haveEqualSignatures(prevType, nextType)) {
    return true
  }
  return false
}

function resolveFamily(type) {
  // Only check updated types to keep lookups fast.
  return updatedFamiliesByType.get(type)
}

// This is a safety mechanism to protect against rogue getters and Proxies.
function getProperty(object, property) {
  try {
    return object[property]
  } catch (err) {
    // Intentionally ignore.
    return undefined
  }
}

function performReactRefresh() {
  if (pendingUpdates.length === 0) {
    return null
  }
  if (isPerformingRefresh) {
    return null
  }

  isPerformingRefresh = true
  try {
    const staleFamilies = new Set()
    const updatedFamilies = new Set()

    const updates = pendingUpdates
    pendingUpdates = []
    updates.forEach(([family, nextType]) => {
      // Now that we got a real edit, we can create associations
      // that will be read by the React reconciler.
      const prevType = family.current
      updatedFamiliesByType.set(prevType, family)
      updatedFamiliesByType.set(nextType, family)
      family.current = nextType

      // Determine whether this should be a re-render or a re-mount.
      if (canPreserveStateBetween(prevType, nextType)) {
        updatedFamilies.add(family)
      } else {
        staleFamilies.add(family)
      }
    })

    // TODO: rename these fields to something more meaningful.
    const update = {
      updatedFamilies, // Families that will re-render preserving state
      staleFamilies, // Families that will be remounted
    }

    helpersByRendererID.forEach((helpers) => {
      // Even if there are no roots, set the handler on first update.
      // This ensures that if *new* roots are mounted, they'll use the resolve handler.
      helpers.setRefreshHandler(resolveFamily)
    })

    let didError = false
    let firstError = null

    // We snapshot maps and sets that are mutated during commits.
    // If we don't do this, there is a risk they will be mutated while
    // we iterate over them. For example, trying to recover a failed root
    // may cause another root to be added to the failed list -- an infinite loop.
    const failedRootsSnapshot = new Set(failedRoots)
    const mountedRootsSnapshot = new Set(mountedRoots)
    const helpersByRootSnapshot = new Map(helpersByRoot)

    failedRootsSnapshot.forEach((root) => {
      const helpers = helpersByRootSnapshot.get(root)
      if (helpers === undefined) {
        throw new Error(
          'Could not find helpers for a root. This is a bug in React Refresh.',
        )
      }
      if (!failedRoots.has(root)) {
        // No longer failed.
      }
      if (rootElements === null) {
        return
      }
      if (!rootElements.has(root)) {
        return
      }
      const element = rootElements.get(root)
      try {
        helpers.scheduleRoot(root, element)
      } catch (err) {
        if (!didError) {
          didError = true
          firstError = err
        }
        // Keep trying other roots.
      }
    })
    mountedRootsSnapshot.forEach((root) => {
      const helpers = helpersByRootSnapshot.get(root)
      if (helpers === undefined) {
        throw new Error(
          'Could not find helpers for a root. This is a bug in React Refresh.',
        )
      }
      if (!mountedRoots.has(root)) {
        // No longer mounted.
      }
      try {
        helpers.scheduleRefresh(root, update)
      } catch (err) {
        if (!didError) {
          didError = true
          firstError = err
        }
        // Keep trying other roots.
      }
    })
    if (didError) {
      throw firstError
    }
    return update
  } finally {
    isPerformingRefresh = false
  }
}

export function register(type, id) {
  if (type === null) {
    return
  }
  if (typeof type !== 'function' && typeof type !== 'object') {
    return
  }

  // This can happen in an edge case, e.g. if we register
  // return value of a HOC but it returns a cached component.
  // Ignore anything but the first registration for each type.
  if (allFamiliesByType.has(type)) {
    return
  }
  // Create family or remember to update it.
  // None of this bookkeeping affects reconciliation
  // until the first performReactRefresh() call above.
  let family = allFamiliesByID.get(id)
  if (family === undefined) {
    family = { current: type }
    allFamiliesByID.set(id, family)
  } else {
    pendingUpdates.push([family, type])
  }
  allFamiliesByType.set(type, family)

  // Visit inner types because we might not have registered them.
  if (typeof type === 'object' && type !== null) {
    switch (getProperty(type, '$$typeof')) {
      case REACT_FORWARD_REF_TYPE:
        register(type.render, id + '$render')
        break
      case REACT_MEMO_TYPE:
        register(type.type, id + '$type')
        break
    }
  }
}

function setSignature(type, key, forceReset, getCustomHooks) {
  if (!allSignaturesByType.has(type)) {
    allSignaturesByType.set(type, {
      forceReset,
      ownKey: key,
      fullKey: null,
      getCustomHooks: getCustomHooks || (() => []),
    })
  }
  // Visit inner types because we might not have signed them.
  if (typeof type === 'object' && type !== null) {
    switch (getProperty(type, '$$typeof')) {
      case REACT_FORWARD_REF_TYPE:
        setSignature(type.render, key, forceReset, getCustomHooks)
        break
      case REACT_MEMO_TYPE:
        setSignature(type.type, key, forceReset, getCustomHooks)
        break
    }
  }
}

// This is lazily called during first render for a type.
// It captures Hook list at that time so inline requires don't break comparisons.
function collectCustomHooksForSignature(type) {
  const signature = allSignaturesByType.get(type)
  if (signature !== undefined) {
    computeFullKey(signature)
  }
}

export function injectIntoGlobalHook(globalObject) {
  // For React Native, the global hook will be set up by require('react-devtools-core').
  // That code will run before us. So we need to monkeypatch functions on existing hook.

  // For React Web, the global hook will be set up by the extension.
  // This will also run before us.
  let hook = globalObject.__REACT_DEVTOOLS_GLOBAL_HOOK__
  if (hook === undefined) {
    // However, if there is no DevTools extension, we'll need to set up the global hook ourselves.
    // Note that in this case it's important that renderer code runs *after* this method call.
    // Otherwise, the renderer will think that there is no global hook, and won't do the injection.
    let nextID = 0
    globalObject.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook = {
      renderers: new Map(),
      supportsFiber: true,
      inject: (injected) => nextID++,
      onScheduleFiberRoot: (id, root, children) => {},
      onCommitFiberRoot: (id, root, maybePriorityLevel, didError) => {},
      onCommitFiberUnmount() {},
    }
  }

  if (hook.isDisabled) {
    // This isn't a real property on the hook, but it can be set to opt out
    // of DevTools integration and associated warnings and logs.
    // Using console['warn'] to evade Babel and ESLint
    console['warn'](
      'Something has shimmed the React DevTools global hook (__REACT_DEVTOOLS_GLOBAL_HOOK__). ' +
        'Fast Refresh is not compatible with this shim and will be disabled.',
    )
    return
  }

  // Here, we just want to get a reference to scheduleRefresh.
  const oldInject = hook.inject
  hook.inject = function (injected) {
    const id = oldInject.apply(this, arguments)
    if (
      typeof injected.scheduleRefresh === 'function' &&
      typeof injected.setRefreshHandler === 'function'
    ) {
      // This version supports React Refresh.
      helpersByRendererID.set(id, injected)
    }
    return id
  }

  // Do the same for any already injected roots.
  // This is useful if ReactDOM has already been initialized.
  // https://github.com/facebook/react/issues/17626
  hook.renderers.forEach((injected, id) => {
    if (
      typeof injected.scheduleRefresh === 'function' &&
      typeof injected.setRefreshHandler === 'function'
    ) {
      // This version supports React Refresh.
      helpersByRendererID.set(id, injected)
    }
  })

  // We also want to track currently mounted roots.
  const oldOnCommitFiberRoot = hook.onCommitFiberRoot
  const oldOnScheduleFiberRoot = hook.onScheduleFiberRoot || (() => {})
  hook.onScheduleFiberRoot = function (id, root, children) {
    if (!isPerformingRefresh) {
      // If it was intentionally scheduled, don't attempt to restore.
      // This includes intentionally scheduled unmounts.
      failedRoots.delete(root)
      if (rootElements !== null) {
        rootElements.set(root, children)
      }
    }
    return oldOnScheduleFiberRoot.apply(this, arguments)
  }
  hook.onCommitFiberRoot = function (id, root, maybePriorityLevel, didError) {
    const helpers = helpersByRendererID.get(id)
    if (helpers !== undefined) {
      helpersByRoot.set(root, helpers)

      const current = root.current
      const alternate = current.alternate

      // We need to determine whether this root has just (un)mounted.
      // This logic is copy-pasted from similar logic in the DevTools backend.
      // If this breaks with some refactoring, you'll want to update DevTools too.

      if (alternate !== null) {
        const wasMounted =
          alternate.memoizedState != null &&
          alternate.memoizedState.element != null &&
          mountedRoots.has(root)

        const isMounted =
          current.memoizedState != null && current.memoizedState.element != null

        if (!wasMounted && isMounted) {
          // Mount a new root.
          mountedRoots.add(root)
          failedRoots.delete(root)
        } else if (wasMounted && isMounted) {
          // Update an existing root.
          // This doesn't affect our mounted root Set.
        } else if (wasMounted && !isMounted) {
          // Unmount an existing root.
          mountedRoots.delete(root)
          if (didError) {
            // We'll remount it on future edits.
            failedRoots.add(root)
          } else {
            helpersByRoot.delete(root)
          }
        } else if (!wasMounted && !isMounted) {
          if (didError) {
            // We'll remount it on future edits.
            failedRoots.add(root)
          }
        }
      } else {
        // Mount a new root.
        mountedRoots.add(root)
      }
    }

    // Always call the decorated DevTools hook.
    return oldOnCommitFiberRoot.apply(this, arguments)
  }
}

// This is a wrapper over more primitive functions for setting signature.
// Signatures let us decide whether the Hook order has changed on refresh.
//
// This function is intended to be used as a transform target, e.g.:
// var _s = createSignatureFunctionForTransform()
//
// function Hello() {
//   const [foo, setFoo] = useState(0);
//   const value = useCustomHook();
//   _s(); /* Call without arguments triggers collecting the custom Hook list.
//          * This doesn't happen during the module evaluation because we
//          * don't want to change the module order with inline requires.
//          * Next calls are noops. */
//   return <h1>Hi</h1>;
// }
//
// /* Call with arguments attaches the signature to the type: */
// _s(
//   Hello,
//   'useState{[foo, setFoo]}(0)',
//   () => [useCustomHook], /* Lazy to avoid triggering inline requires */
// );
export function createSignatureFunctionForTransform() {
  let savedType
  let hasCustomHooks
  let didCollectHooks = false
  return function (type, key, forceReset, getCustomHooks) {
    if (typeof key === 'string') {
      // We're in the initial phase that associates signatures
      // with the functions. Note this may be called multiple times
      // in HOC chains like _s(hoc1(_s(hoc2(_s(actualFunction))))).
      if (!savedType) {
        // We're in the innermost call, so this is the actual type.
        // $FlowFixMe[escaped-generic] discovered when updating Flow
        savedType = type
        hasCustomHooks = typeof getCustomHooks === 'function'
      }
      // Set the signature for all types (even wrappers!) in case
      // they have no signatures of their own. This is to prevent
      // problems like https://github.com/facebook/react/issues/20417.
      if (
        type != null &&
        (typeof type === 'function' || typeof type === 'object')
      ) {
        setSignature(type, key, forceReset, getCustomHooks)
      }
      return type
    } else {
      // We're in the _s() call without arguments, which means
      // this is the time to collect custom Hook signatures.
      // Only do this once. This path is hot and runs *inside* every render!
      if (!didCollectHooks && hasCustomHooks) {
        didCollectHooks = true
        collectCustomHooksForSignature(savedType)
      }
    }
  }
}

function isLikelyComponentType(type) {
  switch (typeof type) {
    case 'function': {
      // First, deal with classes.
      if (type.prototype != null) {
        if (type.prototype.isReactComponent) {
          // React class.
          return true
        }
        const ownNames = Object.getOwnPropertyNames(type.prototype)
        if (ownNames.length > 1 || ownNames[0] !== 'constructor') {
          // This looks like a class.
          return false
        }

        if (type.prototype.__proto__ !== Object.prototype) {
          // It has a superclass.
          return false
        }
        // Pass through.
        // This looks like a regular function with empty prototype.
      }
      // For plain functions and arrows, use name as a heuristic.
      const name = type.name || type.displayName
      return typeof name === 'string' && /^[A-Z]/.test(name)
    }
    case 'object': {
      if (type != null) {
        switch (getProperty(type, '$$typeof')) {
          case REACT_FORWARD_REF_TYPE:
          case REACT_MEMO_TYPE:
            // Definitely React components.
            return true
          default:
            return false
        }
      }
      return false
    }
    default: {
      return false
    }
  }
}

function isCompoundComponent(type) {
  if (!isPlainObject(type)) return false
  for (const key in type) {
    if (!isLikelyComponentType(type[key])) return false
  }
  return true
}

function isPlainObject(obj) {
  return (
    Object.prototype.toString.call(obj) === '[object Object]' &&
    (obj.constructor === Object || obj.constructor === undefined)
  )
}

/**
 * Plugin utils
 */

// Taken from https://github.com/pmmmwh/react-refresh-webpack-plugin/blob/main/lib/runtime/RefreshUtils.js#L141
// This allows to resister components not detected by SWC like styled component
export function registerExportsForReactRefresh(filename, moduleExports) {
  for (const key in moduleExports) {
    if (key === '__esModule') continue
    const exportValue = moduleExports[key]
    if (isLikelyComponentType(exportValue)) {
      // 'export' is required to avoid key collision when renamed exports that
      // shadow a local component name: https://github.com/vitejs/vite-plugin-react/issues/116
      // The register function has an identity check to not register twice the same component,
      // so this is safe to not used the same key here.
      register(exportValue, filename + ' export ' + key)
    } else if (isCompoundComponent(exportValue)) {
      for (const subKey in exportValue) {
        register(
          exportValue[subKey],
          filename + ' export ' + key + '-' + subKey,
        )
      }
    }
  }
}

function debounce(fn, delay) {
  let handle
  return () => {
    clearTimeout(handle)
    handle = setTimeout(fn, delay)
  }
}

const hooks = []
window.__registerBeforePerformReactRefresh = (cb) => {
  hooks.push(cb)
}
const enqueueUpdate = debounce(async () => {
  if (hooks.length) await Promise.all(hooks.map((cb) => cb()))
  performReactRefresh()
}, 16)

export function validateRefreshBoundaryAndEnqueueUpdate(
  id,
  prevExports,
  nextExports,
) {
  const ignoredExports = window.__getReactRefreshIgnoredExports?.({ id }) ?? []
  if (
    predicateOnExport(
      ignoredExports,
      prevExports,
      (key) => key in nextExports,
    ) !== true
  ) {
    return 'Could not Fast Refresh (export removed)'
  }
  if (
    predicateOnExport(
      ignoredExports,
      nextExports,
      (key) => key in prevExports,
    ) !== true
  ) {
    return 'Could not Fast Refresh (new export)'
  }

  let hasExports = false
  const allExportsAreComponentsOrUnchanged = predicateOnExport(
    ignoredExports,
    nextExports,
    (key, value) => {
      hasExports = true
      if (isLikelyComponentType(value)) return true
      if (isCompoundComponent(value)) return true
      return prevExports[key] === nextExports[key]
    },
  )
  if (hasExports && allExportsAreComponentsOrUnchanged === true) {
    enqueueUpdate()
  } else {
    return `Could not Fast Refresh ("${allExportsAreComponentsOrUnchanged}" export is incompatible). Learn more at https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react#consistent-components-exports`
  }
}

function predicateOnExport(ignoredExports, moduleExports, predicate) {
  for (const key in moduleExports) {
    if (ignoredExports.includes(key)) continue
    if (!predicate(key, moduleExports[key])) return key
  }
  return true
}

// Hides vite-ignored dynamic import so that Vite can skip analysis if no other
// dynamic import is present (https://github.com/vitejs/vite/pull/12732)
export const __hmr_import = (module) => import(/* @vite-ignore */ __vite__injectQuery(module, 'import'))

// For backwards compatibility with @vitejs/plugin-react.
export default { injectIntoGlobalHook }

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIkByZWFjdC1yZWZyZXNoIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGluamVjdFF1ZXJ5IGFzIF9fdml0ZV9faW5qZWN0UXVlcnkgfSBmcm9tIFwiL0B2aXRlL2NsaWVudFwiOy8qIGdsb2JhbCB3aW5kb3cgKi9cbi8qIGVzbGludC1kaXNhYmxlIGVxZXFlcSwgcHJlZmVyLWNvbnN0LCBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tZW1wdHktZnVuY3Rpb24gKi9cblxuLyohIENvcHlyaWdodCAoYykgTWV0YSBQbGF0Zm9ybXMsIEluYy4gYW5kIGFmZmlsaWF0ZXMuICoqL1xuLyoqXG4gKiBUaGlzIGlzIHNpbXBsaWZpZWQgcHVyZS1qcyB2ZXJzaW9uIG9mIGh0dHBzOi8vZ2l0aHViLmNvbS9mYWNlYm9vay9yZWFjdC9ibG9iL21haW4vcGFja2FnZXMvcmVhY3QtcmVmcmVzaC9zcmMvUmVhY3RGcmVzaFJ1bnRpbWUuanNcbiAqIHdpdGhvdXQgSUUxMSBjb21wYXRpYmlsaXR5IGFuZCB2ZXJib3NlIGlzRGV2IGNoZWNrcy5cbiAqIFNvbWUgdXRpbHMgYXJlIGFwcGVuZGVkIGF0IHRoZSBib3R0b20gZm9yIEhNUiBpbnRlZ3JhdGlvbi5cbiAqL1xuXG5jb25zdCBSRUFDVF9GT1JXQVJEX1JFRl9UWVBFID0gU3ltYm9sLmZvcigncmVhY3QuZm9yd2FyZF9yZWYnKVxuY29uc3QgUkVBQ1RfTUVNT19UWVBFID0gU3ltYm9sLmZvcigncmVhY3QubWVtbycpXG5cbi8vIFdlIG5ldmVyIHJlbW92ZSB0aGVzZSBhc3NvY2lhdGlvbnMuXG4vLyBJdCdzIE9LIHRvIHJlZmVyZW5jZSBmYW1pbGllcywgYnV0IHVzZSBXZWFrTWFwL1NldCBmb3IgdHlwZXMuXG5sZXQgYWxsRmFtaWxpZXNCeUlEID0gbmV3IE1hcCgpXG5sZXQgYWxsRmFtaWxpZXNCeVR5cGUgPSBuZXcgV2Vha01hcCgpXG5sZXQgYWxsU2lnbmF0dXJlc0J5VHlwZSA9IG5ldyBXZWFrTWFwKClcblxuLy8gVGhpcyBXZWFrTWFwIGlzIHJlYWQgYnkgUmVhY3QsIHNvIHdlIG9ubHkgcHV0IGZhbWlsaWVzXG4vLyB0aGF0IGhhdmUgYWN0dWFsbHkgYmVlbiBlZGl0ZWQgaGVyZS4gVGhpcyBrZWVwcyBjaGVja3MgZmFzdC5cbmNvbnN0IHVwZGF0ZWRGYW1pbGllc0J5VHlwZSA9IG5ldyBXZWFrTWFwKClcblxuLy8gVGhpcyBpcyBjbGVhcmVkIG9uIGV2ZXJ5IHBlcmZvcm1SZWFjdFJlZnJlc2goKSBjYWxsLlxuLy8gSXQgaXMgYW4gYXJyYXkgb2YgW0ZhbWlseSwgTmV4dFR5cGVdIHR1cGxlcy5cbmxldCBwZW5kaW5nVXBkYXRlcyA9IFtdXG5cbi8vIFRoaXMgaXMgaW5qZWN0ZWQgYnkgdGhlIHJlbmRlcmVyIHZpYSBEZXZUb29scyBnbG9iYWwgaG9vay5cbmNvbnN0IGhlbHBlcnNCeVJlbmRlcmVySUQgPSBuZXcgTWFwKClcblxuY29uc3QgaGVscGVyc0J5Um9vdCA9IG5ldyBNYXAoKVxuXG4vLyBXZSBrZWVwIHRyYWNrIG9mIG1vdW50ZWQgcm9vdHMgc28gd2UgY2FuIHNjaGVkdWxlIHVwZGF0ZXMuXG5jb25zdCBtb3VudGVkUm9vdHMgPSBuZXcgU2V0KClcbi8vIElmIGEgcm9vdCBjYXB0dXJlcyBhbiBlcnJvciwgd2UgcmVtZW1iZXIgaXQgc28gd2UgY2FuIHJldHJ5IG9uIGVkaXQuXG5jb25zdCBmYWlsZWRSb290cyA9IG5ldyBTZXQoKVxuXG4vLyBXZSBhbHNvIHJlbWVtYmVyIHRoZSBsYXN0IGVsZW1lbnQgZm9yIGV2ZXJ5IHJvb3QuXG4vLyBJdCBuZWVkcyB0byBiZSB3ZWFrIGJlY2F1c2Ugd2UgZG8gdGhpcyBldmVuIGZvciByb290cyB0aGF0IGZhaWxlZCB0byBtb3VudC5cbi8vIElmIHRoZXJlIGlzIG5vIFdlYWtNYXAsIHdlIHdvbid0IGF0dGVtcHQgdG8gZG8gcmV0cnlpbmcuXG5sZXQgcm9vdEVsZW1lbnRzID0gbmV3IFdlYWtNYXAoKVxubGV0IGlzUGVyZm9ybWluZ1JlZnJlc2ggPSBmYWxzZVxuXG5mdW5jdGlvbiBjb21wdXRlRnVsbEtleShzaWduYXR1cmUpIHtcbiAgaWYgKHNpZ25hdHVyZS5mdWxsS2V5ICE9PSBudWxsKSB7XG4gICAgcmV0dXJuIHNpZ25hdHVyZS5mdWxsS2V5XG4gIH1cblxuICBsZXQgZnVsbEtleSA9IHNpZ25hdHVyZS5vd25LZXlcbiAgbGV0IGhvb2tzXG4gIHRyeSB7XG4gICAgaG9va3MgPSBzaWduYXR1cmUuZ2V0Q3VzdG9tSG9va3MoKVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICAvLyBUaGlzIGNhbiBoYXBwZW4gaW4gYW4gZWRnZSBjYXNlLCBlLmcuIGlmIGV4cHJlc3Npb24gbGlrZSBGb28udXNlU29tZXRoaW5nXG4gICAgLy8gZGVwZW5kcyBvbiBGb28gd2hpY2ggaXMgbGF6aWx5IGluaXRpYWxpemVkIGR1cmluZyByZW5kZXJpbmcuXG4gICAgLy8gSW4gdGhhdCBjYXNlIGp1c3QgYXNzdW1lIHdlJ2xsIGhhdmUgdG8gcmVtb3VudC5cbiAgICBzaWduYXR1cmUuZm9yY2VSZXNldCA9IHRydWVcbiAgICBzaWduYXR1cmUuZnVsbEtleSA9IGZ1bGxLZXlcbiAgICByZXR1cm4gZnVsbEtleVxuICB9XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBob29rcy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGhvb2sgPSBob29rc1tpXVxuICAgIGlmICh0eXBlb2YgaG9vayAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgLy8gU29tZXRoaW5nJ3Mgd3JvbmcuIEFzc3VtZSB3ZSBuZWVkIHRvIHJlbW91bnQuXG4gICAgICBzaWduYXR1cmUuZm9yY2VSZXNldCA9IHRydWVcbiAgICAgIHNpZ25hdHVyZS5mdWxsS2V5ID0gZnVsbEtleVxuICAgICAgcmV0dXJuIGZ1bGxLZXlcbiAgICB9XG4gICAgY29uc3QgbmVzdGVkSG9va1NpZ25hdHVyZSA9IGFsbFNpZ25hdHVyZXNCeVR5cGUuZ2V0KGhvb2spXG4gICAgaWYgKG5lc3RlZEhvb2tTaWduYXR1cmUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgLy8gTm8gc2lnbmF0dXJlIG1lYW5zIEhvb2sgd2Fzbid0IGluIHRoZSBzb3VyY2UgY29kZSwgZS5nLiBpbiBhIGxpYnJhcnkuXG4gICAgICAvLyBXZSdsbCBza2lwIGl0IGJlY2F1c2Ugd2UgY2FuIGFzc3VtZSBpdCB3b24ndCBjaGFuZ2UgZHVyaW5nIHRoaXMgc2Vzc2lvbi5cbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuICAgIGNvbnN0IG5lc3RlZEhvb2tLZXkgPSBjb21wdXRlRnVsbEtleShuZXN0ZWRIb29rU2lnbmF0dXJlKVxuICAgIGlmIChuZXN0ZWRIb29rU2lnbmF0dXJlLmZvcmNlUmVzZXQpIHtcbiAgICAgIHNpZ25hdHVyZS5mb3JjZVJlc2V0ID0gdHJ1ZVxuICAgIH1cbiAgICBmdWxsS2V5ICs9ICdcXG4tLS1cXG4nICsgbmVzdGVkSG9va0tleVxuICB9XG5cbiAgc2lnbmF0dXJlLmZ1bGxLZXkgPSBmdWxsS2V5XG4gIHJldHVybiBmdWxsS2V5XG59XG5cbmZ1bmN0aW9uIGhhdmVFcXVhbFNpZ25hdHVyZXMocHJldlR5cGUsIG5leHRUeXBlKSB7XG4gIGNvbnN0IHByZXZTaWduYXR1cmUgPSBhbGxTaWduYXR1cmVzQnlUeXBlLmdldChwcmV2VHlwZSlcbiAgY29uc3QgbmV4dFNpZ25hdHVyZSA9IGFsbFNpZ25hdHVyZXNCeVR5cGUuZ2V0KG5leHRUeXBlKVxuXG4gIGlmIChwcmV2U2lnbmF0dXJlID09PSB1bmRlZmluZWQgJiYgbmV4dFNpZ25hdHVyZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIHRydWVcbiAgfVxuICBpZiAocHJldlNpZ25hdHVyZSA9PT0gdW5kZWZpbmVkIHx8IG5leHRTaWduYXR1cmUgPT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIGlmIChjb21wdXRlRnVsbEtleShwcmV2U2lnbmF0dXJlKSAhPT0gY29tcHV0ZUZ1bGxLZXkobmV4dFNpZ25hdHVyZSkpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuICBpZiAobmV4dFNpZ25hdHVyZS5mb3JjZVJlc2V0KSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICByZXR1cm4gdHJ1ZVxufVxuXG5mdW5jdGlvbiBpc1JlYWN0Q2xhc3ModHlwZSkge1xuICByZXR1cm4gdHlwZS5wcm90b3R5cGUgJiYgdHlwZS5wcm90b3R5cGUuaXNSZWFjdENvbXBvbmVudFxufVxuXG5mdW5jdGlvbiBjYW5QcmVzZXJ2ZVN0YXRlQmV0d2VlbihwcmV2VHlwZSwgbmV4dFR5cGUpIHtcbiAgaWYgKGlzUmVhY3RDbGFzcyhwcmV2VHlwZSkgfHwgaXNSZWFjdENsYXNzKG5leHRUeXBlKSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIGlmIChoYXZlRXF1YWxTaWduYXR1cmVzKHByZXZUeXBlLCBuZXh0VHlwZSkpIHtcbiAgICByZXR1cm4gdHJ1ZVxuICB9XG4gIHJldHVybiBmYWxzZVxufVxuXG5mdW5jdGlvbiByZXNvbHZlRmFtaWx5KHR5cGUpIHtcbiAgLy8gT25seSBjaGVjayB1cGRhdGVkIHR5cGVzIHRvIGtlZXAgbG9va3VwcyBmYXN0LlxuICByZXR1cm4gdXBkYXRlZEZhbWlsaWVzQnlUeXBlLmdldCh0eXBlKVxufVxuXG4vLyBUaGlzIGlzIGEgc2FmZXR5IG1lY2hhbmlzbSB0byBwcm90ZWN0IGFnYWluc3Qgcm9ndWUgZ2V0dGVycyBhbmQgUHJveGllcy5cbmZ1bmN0aW9uIGdldFByb3BlcnR5KG9iamVjdCwgcHJvcGVydHkpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gb2JqZWN0W3Byb3BlcnR5XVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICAvLyBJbnRlbnRpb25hbGx5IGlnbm9yZS5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cbn1cblxuZnVuY3Rpb24gcGVyZm9ybVJlYWN0UmVmcmVzaCgpIHtcbiAgaWYgKHBlbmRpbmdVcGRhdGVzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBudWxsXG4gIH1cbiAgaWYgKGlzUGVyZm9ybWluZ1JlZnJlc2gpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgaXNQZXJmb3JtaW5nUmVmcmVzaCA9IHRydWVcbiAgdHJ5IHtcbiAgICBjb25zdCBzdGFsZUZhbWlsaWVzID0gbmV3IFNldCgpXG4gICAgY29uc3QgdXBkYXRlZEZhbWlsaWVzID0gbmV3IFNldCgpXG5cbiAgICBjb25zdCB1cGRhdGVzID0gcGVuZGluZ1VwZGF0ZXNcbiAgICBwZW5kaW5nVXBkYXRlcyA9IFtdXG4gICAgdXBkYXRlcy5mb3JFYWNoKChbZmFtaWx5LCBuZXh0VHlwZV0pID0+IHtcbiAgICAgIC8vIE5vdyB0aGF0IHdlIGdvdCBhIHJlYWwgZWRpdCwgd2UgY2FuIGNyZWF0ZSBhc3NvY2lhdGlvbnNcbiAgICAgIC8vIHRoYXQgd2lsbCBiZSByZWFkIGJ5IHRoZSBSZWFjdCByZWNvbmNpbGVyLlxuICAgICAgY29uc3QgcHJldlR5cGUgPSBmYW1pbHkuY3VycmVudFxuICAgICAgdXBkYXRlZEZhbWlsaWVzQnlUeXBlLnNldChwcmV2VHlwZSwgZmFtaWx5KVxuICAgICAgdXBkYXRlZEZhbWlsaWVzQnlUeXBlLnNldChuZXh0VHlwZSwgZmFtaWx5KVxuICAgICAgZmFtaWx5LmN1cnJlbnQgPSBuZXh0VHlwZVxuXG4gICAgICAvLyBEZXRlcm1pbmUgd2hldGhlciB0aGlzIHNob3VsZCBiZSBhIHJlLXJlbmRlciBvciBhIHJlLW1vdW50LlxuICAgICAgaWYgKGNhblByZXNlcnZlU3RhdGVCZXR3ZWVuKHByZXZUeXBlLCBuZXh0VHlwZSkpIHtcbiAgICAgICAgdXBkYXRlZEZhbWlsaWVzLmFkZChmYW1pbHkpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzdGFsZUZhbWlsaWVzLmFkZChmYW1pbHkpXG4gICAgICB9XG4gICAgfSlcblxuICAgIC8vIFRPRE86IHJlbmFtZSB0aGVzZSBmaWVsZHMgdG8gc29tZXRoaW5nIG1vcmUgbWVhbmluZ2Z1bC5cbiAgICBjb25zdCB1cGRhdGUgPSB7XG4gICAgICB1cGRhdGVkRmFtaWxpZXMsIC8vIEZhbWlsaWVzIHRoYXQgd2lsbCByZS1yZW5kZXIgcHJlc2VydmluZyBzdGF0ZVxuICAgICAgc3RhbGVGYW1pbGllcywgLy8gRmFtaWxpZXMgdGhhdCB3aWxsIGJlIHJlbW91bnRlZFxuICAgIH1cblxuICAgIGhlbHBlcnNCeVJlbmRlcmVySUQuZm9yRWFjaCgoaGVscGVycykgPT4ge1xuICAgICAgLy8gRXZlbiBpZiB0aGVyZSBhcmUgbm8gcm9vdHMsIHNldCB0aGUgaGFuZGxlciBvbiBmaXJzdCB1cGRhdGUuXG4gICAgICAvLyBUaGlzIGVuc3VyZXMgdGhhdCBpZiAqbmV3KiByb290cyBhcmUgbW91bnRlZCwgdGhleSdsbCB1c2UgdGhlIHJlc29sdmUgaGFuZGxlci5cbiAgICAgIGhlbHBlcnMuc2V0UmVmcmVzaEhhbmRsZXIocmVzb2x2ZUZhbWlseSlcbiAgICB9KVxuXG4gICAgbGV0IGRpZEVycm9yID0gZmFsc2VcbiAgICBsZXQgZmlyc3RFcnJvciA9IG51bGxcblxuICAgIC8vIFdlIHNuYXBzaG90IG1hcHMgYW5kIHNldHMgdGhhdCBhcmUgbXV0YXRlZCBkdXJpbmcgY29tbWl0cy5cbiAgICAvLyBJZiB3ZSBkb24ndCBkbyB0aGlzLCB0aGVyZSBpcyBhIHJpc2sgdGhleSB3aWxsIGJlIG11dGF0ZWQgd2hpbGVcbiAgICAvLyB3ZSBpdGVyYXRlIG92ZXIgdGhlbS4gRm9yIGV4YW1wbGUsIHRyeWluZyB0byByZWNvdmVyIGEgZmFpbGVkIHJvb3RcbiAgICAvLyBtYXkgY2F1c2UgYW5vdGhlciByb290IHRvIGJlIGFkZGVkIHRvIHRoZSBmYWlsZWQgbGlzdCAtLSBhbiBpbmZpbml0ZSBsb29wLlxuICAgIGNvbnN0IGZhaWxlZFJvb3RzU25hcHNob3QgPSBuZXcgU2V0KGZhaWxlZFJvb3RzKVxuICAgIGNvbnN0IG1vdW50ZWRSb290c1NuYXBzaG90ID0gbmV3IFNldChtb3VudGVkUm9vdHMpXG4gICAgY29uc3QgaGVscGVyc0J5Um9vdFNuYXBzaG90ID0gbmV3IE1hcChoZWxwZXJzQnlSb290KVxuXG4gICAgZmFpbGVkUm9vdHNTbmFwc2hvdC5mb3JFYWNoKChyb290KSA9PiB7XG4gICAgICBjb25zdCBoZWxwZXJzID0gaGVscGVyc0J5Um9vdFNuYXBzaG90LmdldChyb290KVxuICAgICAgaWYgKGhlbHBlcnMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgJ0NvdWxkIG5vdCBmaW5kIGhlbHBlcnMgZm9yIGEgcm9vdC4gVGhpcyBpcyBhIGJ1ZyBpbiBSZWFjdCBSZWZyZXNoLicsXG4gICAgICAgIClcbiAgICAgIH1cbiAgICAgIGlmICghZmFpbGVkUm9vdHMuaGFzKHJvb3QpKSB7XG4gICAgICAgIC8vIE5vIGxvbmdlciBmYWlsZWQuXG4gICAgICB9XG4gICAgICBpZiAocm9vdEVsZW1lbnRzID09PSBudWxsKSB7XG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgICAgaWYgKCFyb290RWxlbWVudHMuaGFzKHJvb3QpKSB7XG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgICAgY29uc3QgZWxlbWVudCA9IHJvb3RFbGVtZW50cy5nZXQocm9vdClcbiAgICAgIHRyeSB7XG4gICAgICAgIGhlbHBlcnMuc2NoZWR1bGVSb290KHJvb3QsIGVsZW1lbnQpXG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgaWYgKCFkaWRFcnJvcikge1xuICAgICAgICAgIGRpZEVycm9yID0gdHJ1ZVxuICAgICAgICAgIGZpcnN0RXJyb3IgPSBlcnJcbiAgICAgICAgfVxuICAgICAgICAvLyBLZWVwIHRyeWluZyBvdGhlciByb290cy5cbiAgICAgIH1cbiAgICB9KVxuICAgIG1vdW50ZWRSb290c1NuYXBzaG90LmZvckVhY2goKHJvb3QpID0+IHtcbiAgICAgIGNvbnN0IGhlbHBlcnMgPSBoZWxwZXJzQnlSb290U25hcHNob3QuZ2V0KHJvb3QpXG4gICAgICBpZiAoaGVscGVycyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAnQ291bGQgbm90IGZpbmQgaGVscGVycyBmb3IgYSByb290LiBUaGlzIGlzIGEgYnVnIGluIFJlYWN0IFJlZnJlc2guJyxcbiAgICAgICAgKVxuICAgICAgfVxuICAgICAgaWYgKCFtb3VudGVkUm9vdHMuaGFzKHJvb3QpKSB7XG4gICAgICAgIC8vIE5vIGxvbmdlciBtb3VudGVkLlxuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgaGVscGVycy5zY2hlZHVsZVJlZnJlc2gocm9vdCwgdXBkYXRlKVxuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGlmICghZGlkRXJyb3IpIHtcbiAgICAgICAgICBkaWRFcnJvciA9IHRydWVcbiAgICAgICAgICBmaXJzdEVycm9yID0gZXJyXG4gICAgICAgIH1cbiAgICAgICAgLy8gS2VlcCB0cnlpbmcgb3RoZXIgcm9vdHMuXG4gICAgICB9XG4gICAgfSlcbiAgICBpZiAoZGlkRXJyb3IpIHtcbiAgICAgIHRocm93IGZpcnN0RXJyb3JcbiAgICB9XG4gICAgcmV0dXJuIHVwZGF0ZVxuICB9IGZpbmFsbHkge1xuICAgIGlzUGVyZm9ybWluZ1JlZnJlc2ggPSBmYWxzZVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWdpc3Rlcih0eXBlLCBpZCkge1xuICBpZiAodHlwZSA9PT0gbnVsbCkge1xuICAgIHJldHVyblxuICB9XG4gIGlmICh0eXBlb2YgdHlwZSAhPT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgdHlwZSAhPT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm5cbiAgfVxuXG4gIC8vIFRoaXMgY2FuIGhhcHBlbiBpbiBhbiBlZGdlIGNhc2UsIGUuZy4gaWYgd2UgcmVnaXN0ZXJcbiAgLy8gcmV0dXJuIHZhbHVlIG9mIGEgSE9DIGJ1dCBpdCByZXR1cm5zIGEgY2FjaGVkIGNvbXBvbmVudC5cbiAgLy8gSWdub3JlIGFueXRoaW5nIGJ1dCB0aGUgZmlyc3QgcmVnaXN0cmF0aW9uIGZvciBlYWNoIHR5cGUuXG4gIGlmIChhbGxGYW1pbGllc0J5VHlwZS5oYXModHlwZSkpIHtcbiAgICByZXR1cm5cbiAgfVxuICAvLyBDcmVhdGUgZmFtaWx5IG9yIHJlbWVtYmVyIHRvIHVwZGF0ZSBpdC5cbiAgLy8gTm9uZSBvZiB0aGlzIGJvb2trZWVwaW5nIGFmZmVjdHMgcmVjb25jaWxpYXRpb25cbiAgLy8gdW50aWwgdGhlIGZpcnN0IHBlcmZvcm1SZWFjdFJlZnJlc2goKSBjYWxsIGFib3ZlLlxuICBsZXQgZmFtaWx5ID0gYWxsRmFtaWxpZXNCeUlELmdldChpZClcbiAgaWYgKGZhbWlseSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgZmFtaWx5ID0geyBjdXJyZW50OiB0eXBlIH1cbiAgICBhbGxGYW1pbGllc0J5SUQuc2V0KGlkLCBmYW1pbHkpXG4gIH0gZWxzZSB7XG4gICAgcGVuZGluZ1VwZGF0ZXMucHVzaChbZmFtaWx5LCB0eXBlXSlcbiAgfVxuICBhbGxGYW1pbGllc0J5VHlwZS5zZXQodHlwZSwgZmFtaWx5KVxuXG4gIC8vIFZpc2l0IGlubmVyIHR5cGVzIGJlY2F1c2Ugd2UgbWlnaHQgbm90IGhhdmUgcmVnaXN0ZXJlZCB0aGVtLlxuICBpZiAodHlwZW9mIHR5cGUgPT09ICdvYmplY3QnICYmIHR5cGUgIT09IG51bGwpIHtcbiAgICBzd2l0Y2ggKGdldFByb3BlcnR5KHR5cGUsICckJHR5cGVvZicpKSB7XG4gICAgICBjYXNlIFJFQUNUX0ZPUldBUkRfUkVGX1RZUEU6XG4gICAgICAgIHJlZ2lzdGVyKHR5cGUucmVuZGVyLCBpZCArICckcmVuZGVyJylcbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgUkVBQ1RfTUVNT19UWVBFOlxuICAgICAgICByZWdpc3Rlcih0eXBlLnR5cGUsIGlkICsgJyR0eXBlJylcbiAgICAgICAgYnJlYWtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gc2V0U2lnbmF0dXJlKHR5cGUsIGtleSwgZm9yY2VSZXNldCwgZ2V0Q3VzdG9tSG9va3MpIHtcbiAgaWYgKCFhbGxTaWduYXR1cmVzQnlUeXBlLmhhcyh0eXBlKSkge1xuICAgIGFsbFNpZ25hdHVyZXNCeVR5cGUuc2V0KHR5cGUsIHtcbiAgICAgIGZvcmNlUmVzZXQsXG4gICAgICBvd25LZXk6IGtleSxcbiAgICAgIGZ1bGxLZXk6IG51bGwsXG4gICAgICBnZXRDdXN0b21Ib29rczogZ2V0Q3VzdG9tSG9va3MgfHwgKCgpID0+IFtdKSxcbiAgICB9KVxuICB9XG4gIC8vIFZpc2l0IGlubmVyIHR5cGVzIGJlY2F1c2Ugd2UgbWlnaHQgbm90IGhhdmUgc2lnbmVkIHRoZW0uXG4gIGlmICh0eXBlb2YgdHlwZSA9PT0gJ29iamVjdCcgJiYgdHlwZSAhPT0gbnVsbCkge1xuICAgIHN3aXRjaCAoZ2V0UHJvcGVydHkodHlwZSwgJyQkdHlwZW9mJykpIHtcbiAgICAgIGNhc2UgUkVBQ1RfRk9SV0FSRF9SRUZfVFlQRTpcbiAgICAgICAgc2V0U2lnbmF0dXJlKHR5cGUucmVuZGVyLCBrZXksIGZvcmNlUmVzZXQsIGdldEN1c3RvbUhvb2tzKVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSBSRUFDVF9NRU1PX1RZUEU6XG4gICAgICAgIHNldFNpZ25hdHVyZSh0eXBlLnR5cGUsIGtleSwgZm9yY2VSZXNldCwgZ2V0Q3VzdG9tSG9va3MpXG4gICAgICAgIGJyZWFrXG4gICAgfVxuICB9XG59XG5cbi8vIFRoaXMgaXMgbGF6aWx5IGNhbGxlZCBkdXJpbmcgZmlyc3QgcmVuZGVyIGZvciBhIHR5cGUuXG4vLyBJdCBjYXB0dXJlcyBIb29rIGxpc3QgYXQgdGhhdCB0aW1lIHNvIGlubGluZSByZXF1aXJlcyBkb24ndCBicmVhayBjb21wYXJpc29ucy5cbmZ1bmN0aW9uIGNvbGxlY3RDdXN0b21Ib29rc0ZvclNpZ25hdHVyZSh0eXBlKSB7XG4gIGNvbnN0IHNpZ25hdHVyZSA9IGFsbFNpZ25hdHVyZXNCeVR5cGUuZ2V0KHR5cGUpXG4gIGlmIChzaWduYXR1cmUgIT09IHVuZGVmaW5lZCkge1xuICAgIGNvbXB1dGVGdWxsS2V5KHNpZ25hdHVyZSlcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5qZWN0SW50b0dsb2JhbEhvb2soZ2xvYmFsT2JqZWN0KSB7XG4gIC8vIEZvciBSZWFjdCBOYXRpdmUsIHRoZSBnbG9iYWwgaG9vayB3aWxsIGJlIHNldCB1cCBieSByZXF1aXJlKCdyZWFjdC1kZXZ0b29scy1jb3JlJykuXG4gIC8vIFRoYXQgY29kZSB3aWxsIHJ1biBiZWZvcmUgdXMuIFNvIHdlIG5lZWQgdG8gbW9ua2V5cGF0Y2ggZnVuY3Rpb25zIG9uIGV4aXN0aW5nIGhvb2suXG5cbiAgLy8gRm9yIFJlYWN0IFdlYiwgdGhlIGdsb2JhbCBob29rIHdpbGwgYmUgc2V0IHVwIGJ5IHRoZSBleHRlbnNpb24uXG4gIC8vIFRoaXMgd2lsbCBhbHNvIHJ1biBiZWZvcmUgdXMuXG4gIGxldCBob29rID0gZ2xvYmFsT2JqZWN0Ll9fUkVBQ1RfREVWVE9PTFNfR0xPQkFMX0hPT0tfX1xuICBpZiAoaG9vayA9PT0gdW5kZWZpbmVkKSB7XG4gICAgLy8gSG93ZXZlciwgaWYgdGhlcmUgaXMgbm8gRGV2VG9vbHMgZXh0ZW5zaW9uLCB3ZSdsbCBuZWVkIHRvIHNldCB1cCB0aGUgZ2xvYmFsIGhvb2sgb3Vyc2VsdmVzLlxuICAgIC8vIE5vdGUgdGhhdCBpbiB0aGlzIGNhc2UgaXQncyBpbXBvcnRhbnQgdGhhdCByZW5kZXJlciBjb2RlIHJ1bnMgKmFmdGVyKiB0aGlzIG1ldGhvZCBjYWxsLlxuICAgIC8vIE90aGVyd2lzZSwgdGhlIHJlbmRlcmVyIHdpbGwgdGhpbmsgdGhhdCB0aGVyZSBpcyBubyBnbG9iYWwgaG9vaywgYW5kIHdvbid0IGRvIHRoZSBpbmplY3Rpb24uXG4gICAgbGV0IG5leHRJRCA9IDBcbiAgICBnbG9iYWxPYmplY3QuX19SRUFDVF9ERVZUT09MU19HTE9CQUxfSE9PS19fID0gaG9vayA9IHtcbiAgICAgIHJlbmRlcmVyczogbmV3IE1hcCgpLFxuICAgICAgc3VwcG9ydHNGaWJlcjogdHJ1ZSxcbiAgICAgIGluamVjdDogKGluamVjdGVkKSA9PiBuZXh0SUQrKyxcbiAgICAgIG9uU2NoZWR1bGVGaWJlclJvb3Q6IChpZCwgcm9vdCwgY2hpbGRyZW4pID0+IHt9LFxuICAgICAgb25Db21taXRGaWJlclJvb3Q6IChpZCwgcm9vdCwgbWF5YmVQcmlvcml0eUxldmVsLCBkaWRFcnJvcikgPT4ge30sXG4gICAgICBvbkNvbW1pdEZpYmVyVW5tb3VudCgpIHt9LFxuICAgIH1cbiAgfVxuXG4gIGlmIChob29rLmlzRGlzYWJsZWQpIHtcbiAgICAvLyBUaGlzIGlzbid0IGEgcmVhbCBwcm9wZXJ0eSBvbiB0aGUgaG9vaywgYnV0IGl0IGNhbiBiZSBzZXQgdG8gb3B0IG91dFxuICAgIC8vIG9mIERldlRvb2xzIGludGVncmF0aW9uIGFuZCBhc3NvY2lhdGVkIHdhcm5pbmdzIGFuZCBsb2dzLlxuICAgIC8vIFVzaW5nIGNvbnNvbGVbJ3dhcm4nXSB0byBldmFkZSBCYWJlbCBhbmQgRVNMaW50XG4gICAgY29uc29sZVsnd2FybiddKFxuICAgICAgJ1NvbWV0aGluZyBoYXMgc2hpbW1lZCB0aGUgUmVhY3QgRGV2VG9vbHMgZ2xvYmFsIGhvb2sgKF9fUkVBQ1RfREVWVE9PTFNfR0xPQkFMX0hPT0tfXykuICcgK1xuICAgICAgICAnRmFzdCBSZWZyZXNoIGlzIG5vdCBjb21wYXRpYmxlIHdpdGggdGhpcyBzaGltIGFuZCB3aWxsIGJlIGRpc2FibGVkLicsXG4gICAgKVxuICAgIHJldHVyblxuICB9XG5cbiAgLy8gSGVyZSwgd2UganVzdCB3YW50IHRvIGdldCBhIHJlZmVyZW5jZSB0byBzY2hlZHVsZVJlZnJlc2guXG4gIGNvbnN0IG9sZEluamVjdCA9IGhvb2suaW5qZWN0XG4gIGhvb2suaW5qZWN0ID0gZnVuY3Rpb24gKGluamVjdGVkKSB7XG4gICAgY29uc3QgaWQgPSBvbGRJbmplY3QuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgIGlmIChcbiAgICAgIHR5cGVvZiBpbmplY3RlZC5zY2hlZHVsZVJlZnJlc2ggPT09ICdmdW5jdGlvbicgJiZcbiAgICAgIHR5cGVvZiBpbmplY3RlZC5zZXRSZWZyZXNoSGFuZGxlciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICkge1xuICAgICAgLy8gVGhpcyB2ZXJzaW9uIHN1cHBvcnRzIFJlYWN0IFJlZnJlc2guXG4gICAgICBoZWxwZXJzQnlSZW5kZXJlcklELnNldChpZCwgaW5qZWN0ZWQpXG4gICAgfVxuICAgIHJldHVybiBpZFxuICB9XG5cbiAgLy8gRG8gdGhlIHNhbWUgZm9yIGFueSBhbHJlYWR5IGluamVjdGVkIHJvb3RzLlxuICAvLyBUaGlzIGlzIHVzZWZ1bCBpZiBSZWFjdERPTSBoYXMgYWxyZWFkeSBiZWVuIGluaXRpYWxpemVkLlxuICAvLyBodHRwczovL2dpdGh1Yi5jb20vZmFjZWJvb2svcmVhY3QvaXNzdWVzLzE3NjI2XG4gIGhvb2sucmVuZGVyZXJzLmZvckVhY2goKGluamVjdGVkLCBpZCkgPT4ge1xuICAgIGlmIChcbiAgICAgIHR5cGVvZiBpbmplY3RlZC5zY2hlZHVsZVJlZnJlc2ggPT09ICdmdW5jdGlvbicgJiZcbiAgICAgIHR5cGVvZiBpbmplY3RlZC5zZXRSZWZyZXNoSGFuZGxlciA9PT0gJ2Z1bmN0aW9uJ1xuICAgICkge1xuICAgICAgLy8gVGhpcyB2ZXJzaW9uIHN1cHBvcnRzIFJlYWN0IFJlZnJlc2guXG4gICAgICBoZWxwZXJzQnlSZW5kZXJlcklELnNldChpZCwgaW5qZWN0ZWQpXG4gICAgfVxuICB9KVxuXG4gIC8vIFdlIGFsc28gd2FudCB0byB0cmFjayBjdXJyZW50bHkgbW91bnRlZCByb290cy5cbiAgY29uc3Qgb2xkT25Db21taXRGaWJlclJvb3QgPSBob29rLm9uQ29tbWl0RmliZXJSb290XG4gIGNvbnN0IG9sZE9uU2NoZWR1bGVGaWJlclJvb3QgPSBob29rLm9uU2NoZWR1bGVGaWJlclJvb3QgfHwgKCgpID0+IHt9KVxuICBob29rLm9uU2NoZWR1bGVGaWJlclJvb3QgPSBmdW5jdGlvbiAoaWQsIHJvb3QsIGNoaWxkcmVuKSB7XG4gICAgaWYgKCFpc1BlcmZvcm1pbmdSZWZyZXNoKSB7XG4gICAgICAvLyBJZiBpdCB3YXMgaW50ZW50aW9uYWxseSBzY2hlZHVsZWQsIGRvbid0IGF0dGVtcHQgdG8gcmVzdG9yZS5cbiAgICAgIC8vIFRoaXMgaW5jbHVkZXMgaW50ZW50aW9uYWxseSBzY2hlZHVsZWQgdW5tb3VudHMuXG4gICAgICBmYWlsZWRSb290cy5kZWxldGUocm9vdClcbiAgICAgIGlmIChyb290RWxlbWVudHMgIT09IG51bGwpIHtcbiAgICAgICAgcm9vdEVsZW1lbnRzLnNldChyb290LCBjaGlsZHJlbilcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG9sZE9uU2NoZWR1bGVGaWJlclJvb3QuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICB9XG4gIGhvb2sub25Db21taXRGaWJlclJvb3QgPSBmdW5jdGlvbiAoaWQsIHJvb3QsIG1heWJlUHJpb3JpdHlMZXZlbCwgZGlkRXJyb3IpIHtcbiAgICBjb25zdCBoZWxwZXJzID0gaGVscGVyc0J5UmVuZGVyZXJJRC5nZXQoaWQpXG4gICAgaWYgKGhlbHBlcnMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaGVscGVyc0J5Um9vdC5zZXQocm9vdCwgaGVscGVycylcblxuICAgICAgY29uc3QgY3VycmVudCA9IHJvb3QuY3VycmVudFxuICAgICAgY29uc3QgYWx0ZXJuYXRlID0gY3VycmVudC5hbHRlcm5hdGVcblxuICAgICAgLy8gV2UgbmVlZCB0byBkZXRlcm1pbmUgd2hldGhlciB0aGlzIHJvb3QgaGFzIGp1c3QgKHVuKW1vdW50ZWQuXG4gICAgICAvLyBUaGlzIGxvZ2ljIGlzIGNvcHktcGFzdGVkIGZyb20gc2ltaWxhciBsb2dpYyBpbiB0aGUgRGV2VG9vbHMgYmFja2VuZC5cbiAgICAgIC8vIElmIHRoaXMgYnJlYWtzIHdpdGggc29tZSByZWZhY3RvcmluZywgeW91J2xsIHdhbnQgdG8gdXBkYXRlIERldlRvb2xzIHRvby5cblxuICAgICAgaWYgKGFsdGVybmF0ZSAhPT0gbnVsbCkge1xuICAgICAgICBjb25zdCB3YXNNb3VudGVkID1cbiAgICAgICAgICBhbHRlcm5hdGUubWVtb2l6ZWRTdGF0ZSAhPSBudWxsICYmXG4gICAgICAgICAgYWx0ZXJuYXRlLm1lbW9pemVkU3RhdGUuZWxlbWVudCAhPSBudWxsICYmXG4gICAgICAgICAgbW91bnRlZFJvb3RzLmhhcyhyb290KVxuXG4gICAgICAgIGNvbnN0IGlzTW91bnRlZCA9XG4gICAgICAgICAgY3VycmVudC5tZW1vaXplZFN0YXRlICE9IG51bGwgJiYgY3VycmVudC5tZW1vaXplZFN0YXRlLmVsZW1lbnQgIT0gbnVsbFxuXG4gICAgICAgIGlmICghd2FzTW91bnRlZCAmJiBpc01vdW50ZWQpIHtcbiAgICAgICAgICAvLyBNb3VudCBhIG5ldyByb290LlxuICAgICAgICAgIG1vdW50ZWRSb290cy5hZGQocm9vdClcbiAgICAgICAgICBmYWlsZWRSb290cy5kZWxldGUocm9vdClcbiAgICAgICAgfSBlbHNlIGlmICh3YXNNb3VudGVkICYmIGlzTW91bnRlZCkge1xuICAgICAgICAgIC8vIFVwZGF0ZSBhbiBleGlzdGluZyByb290LlxuICAgICAgICAgIC8vIFRoaXMgZG9lc24ndCBhZmZlY3Qgb3VyIG1vdW50ZWQgcm9vdCBTZXQuXG4gICAgICAgIH0gZWxzZSBpZiAod2FzTW91bnRlZCAmJiAhaXNNb3VudGVkKSB7XG4gICAgICAgICAgLy8gVW5tb3VudCBhbiBleGlzdGluZyByb290LlxuICAgICAgICAgIG1vdW50ZWRSb290cy5kZWxldGUocm9vdClcbiAgICAgICAgICBpZiAoZGlkRXJyb3IpIHtcbiAgICAgICAgICAgIC8vIFdlJ2xsIHJlbW91bnQgaXQgb24gZnV0dXJlIGVkaXRzLlxuICAgICAgICAgICAgZmFpbGVkUm9vdHMuYWRkKHJvb3QpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGhlbHBlcnNCeVJvb3QuZGVsZXRlKHJvb3QpXG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKCF3YXNNb3VudGVkICYmICFpc01vdW50ZWQpIHtcbiAgICAgICAgICBpZiAoZGlkRXJyb3IpIHtcbiAgICAgICAgICAgIC8vIFdlJ2xsIHJlbW91bnQgaXQgb24gZnV0dXJlIGVkaXRzLlxuICAgICAgICAgICAgZmFpbGVkUm9vdHMuYWRkKHJvb3QpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBNb3VudCBhIG5ldyByb290LlxuICAgICAgICBtb3VudGVkUm9vdHMuYWRkKHJvb3QpXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQWx3YXlzIGNhbGwgdGhlIGRlY29yYXRlZCBEZXZUb29scyBob29rLlxuICAgIHJldHVybiBvbGRPbkNvbW1pdEZpYmVyUm9vdC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gIH1cbn1cblxuLy8gVGhpcyBpcyBhIHdyYXBwZXIgb3ZlciBtb3JlIHByaW1pdGl2ZSBmdW5jdGlvbnMgZm9yIHNldHRpbmcgc2lnbmF0dXJlLlxuLy8gU2lnbmF0dXJlcyBsZXQgdXMgZGVjaWRlIHdoZXRoZXIgdGhlIEhvb2sgb3JkZXIgaGFzIGNoYW5nZWQgb24gcmVmcmVzaC5cbi8vXG4vLyBUaGlzIGZ1bmN0aW9uIGlzIGludGVuZGVkIHRvIGJlIHVzZWQgYXMgYSB0cmFuc2Zvcm0gdGFyZ2V0LCBlLmcuOlxuLy8gdmFyIF9zID0gY3JlYXRlU2lnbmF0dXJlRnVuY3Rpb25Gb3JUcmFuc2Zvcm0oKVxuLy9cbi8vIGZ1bmN0aW9uIEhlbGxvKCkge1xuLy8gICBjb25zdCBbZm9vLCBzZXRGb29dID0gdXNlU3RhdGUoMCk7XG4vLyAgIGNvbnN0IHZhbHVlID0gdXNlQ3VzdG9tSG9vaygpO1xuLy8gICBfcygpOyAvKiBDYWxsIHdpdGhvdXQgYXJndW1lbnRzIHRyaWdnZXJzIGNvbGxlY3RpbmcgdGhlIGN1c3RvbSBIb29rIGxpc3QuXG4vLyAgICAgICAgICAqIFRoaXMgZG9lc24ndCBoYXBwZW4gZHVyaW5nIHRoZSBtb2R1bGUgZXZhbHVhdGlvbiBiZWNhdXNlIHdlXG4vLyAgICAgICAgICAqIGRvbid0IHdhbnQgdG8gY2hhbmdlIHRoZSBtb2R1bGUgb3JkZXIgd2l0aCBpbmxpbmUgcmVxdWlyZXMuXG4vLyAgICAgICAgICAqIE5leHQgY2FsbHMgYXJlIG5vb3BzLiAqL1xuLy8gICByZXR1cm4gPGgxPkhpPC9oMT47XG4vLyB9XG4vL1xuLy8gLyogQ2FsbCB3aXRoIGFyZ3VtZW50cyBhdHRhY2hlcyB0aGUgc2lnbmF0dXJlIHRvIHRoZSB0eXBlOiAqL1xuLy8gX3MoXG4vLyAgIEhlbGxvLFxuLy8gICAndXNlU3RhdGV7W2Zvbywgc2V0Rm9vXX0oMCknLFxuLy8gICAoKSA9PiBbdXNlQ3VzdG9tSG9va10sIC8qIExhenkgdG8gYXZvaWQgdHJpZ2dlcmluZyBpbmxpbmUgcmVxdWlyZXMgKi9cbi8vICk7XG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlU2lnbmF0dXJlRnVuY3Rpb25Gb3JUcmFuc2Zvcm0oKSB7XG4gIGxldCBzYXZlZFR5cGVcbiAgbGV0IGhhc0N1c3RvbUhvb2tzXG4gIGxldCBkaWRDb2xsZWN0SG9va3MgPSBmYWxzZVxuICByZXR1cm4gZnVuY3Rpb24gKHR5cGUsIGtleSwgZm9yY2VSZXNldCwgZ2V0Q3VzdG9tSG9va3MpIHtcbiAgICBpZiAodHlwZW9mIGtleSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIC8vIFdlJ3JlIGluIHRoZSBpbml0aWFsIHBoYXNlIHRoYXQgYXNzb2NpYXRlcyBzaWduYXR1cmVzXG4gICAgICAvLyB3aXRoIHRoZSBmdW5jdGlvbnMuIE5vdGUgdGhpcyBtYXkgYmUgY2FsbGVkIG11bHRpcGxlIHRpbWVzXG4gICAgICAvLyBpbiBIT0MgY2hhaW5zIGxpa2UgX3MoaG9jMShfcyhob2MyKF9zKGFjdHVhbEZ1bmN0aW9uKSkpKSkuXG4gICAgICBpZiAoIXNhdmVkVHlwZSkge1xuICAgICAgICAvLyBXZSdyZSBpbiB0aGUgaW5uZXJtb3N0IGNhbGwsIHNvIHRoaXMgaXMgdGhlIGFjdHVhbCB0eXBlLlxuICAgICAgICAvLyAkRmxvd0ZpeE1lW2VzY2FwZWQtZ2VuZXJpY10gZGlzY292ZXJlZCB3aGVuIHVwZGF0aW5nIEZsb3dcbiAgICAgICAgc2F2ZWRUeXBlID0gdHlwZVxuICAgICAgICBoYXNDdXN0b21Ib29rcyA9IHR5cGVvZiBnZXRDdXN0b21Ib29rcyA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgfVxuICAgICAgLy8gU2V0IHRoZSBzaWduYXR1cmUgZm9yIGFsbCB0eXBlcyAoZXZlbiB3cmFwcGVycyEpIGluIGNhc2VcbiAgICAgIC8vIHRoZXkgaGF2ZSBubyBzaWduYXR1cmVzIG9mIHRoZWlyIG93bi4gVGhpcyBpcyB0byBwcmV2ZW50XG4gICAgICAvLyBwcm9ibGVtcyBsaWtlIGh0dHBzOi8vZ2l0aHViLmNvbS9mYWNlYm9vay9yZWFjdC9pc3N1ZXMvMjA0MTcuXG4gICAgICBpZiAoXG4gICAgICAgIHR5cGUgIT0gbnVsbCAmJlxuICAgICAgICAodHlwZW9mIHR5cGUgPT09ICdmdW5jdGlvbicgfHwgdHlwZW9mIHR5cGUgPT09ICdvYmplY3QnKVxuICAgICAgKSB7XG4gICAgICAgIHNldFNpZ25hdHVyZSh0eXBlLCBrZXksIGZvcmNlUmVzZXQsIGdldEN1c3RvbUhvb2tzKVxuICAgICAgfVxuICAgICAgcmV0dXJuIHR5cGVcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gV2UncmUgaW4gdGhlIF9zKCkgY2FsbCB3aXRob3V0IGFyZ3VtZW50cywgd2hpY2ggbWVhbnNcbiAgICAgIC8vIHRoaXMgaXMgdGhlIHRpbWUgdG8gY29sbGVjdCBjdXN0b20gSG9vayBzaWduYXR1cmVzLlxuICAgICAgLy8gT25seSBkbyB0aGlzIG9uY2UuIFRoaXMgcGF0aCBpcyBob3QgYW5kIHJ1bnMgKmluc2lkZSogZXZlcnkgcmVuZGVyIVxuICAgICAgaWYgKCFkaWRDb2xsZWN0SG9va3MgJiYgaGFzQ3VzdG9tSG9va3MpIHtcbiAgICAgICAgZGlkQ29sbGVjdEhvb2tzID0gdHJ1ZVxuICAgICAgICBjb2xsZWN0Q3VzdG9tSG9va3NGb3JTaWduYXR1cmUoc2F2ZWRUeXBlKVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBpc0xpa2VseUNvbXBvbmVudFR5cGUodHlwZSkge1xuICBzd2l0Y2ggKHR5cGVvZiB0eXBlKSB7XG4gICAgY2FzZSAnZnVuY3Rpb24nOiB7XG4gICAgICAvLyBGaXJzdCwgZGVhbCB3aXRoIGNsYXNzZXMuXG4gICAgICBpZiAodHlwZS5wcm90b3R5cGUgIT0gbnVsbCkge1xuICAgICAgICBpZiAodHlwZS5wcm90b3R5cGUuaXNSZWFjdENvbXBvbmVudCkge1xuICAgICAgICAgIC8vIFJlYWN0IGNsYXNzLlxuICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgb3duTmFtZXMgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyh0eXBlLnByb3RvdHlwZSlcbiAgICAgICAgaWYgKG93bk5hbWVzLmxlbmd0aCA+IDEgfHwgb3duTmFtZXNbMF0gIT09ICdjb25zdHJ1Y3RvcicpIHtcbiAgICAgICAgICAvLyBUaGlzIGxvb2tzIGxpa2UgYSBjbGFzcy5cbiAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0eXBlLnByb3RvdHlwZS5fX3Byb3RvX18gIT09IE9iamVjdC5wcm90b3R5cGUpIHtcbiAgICAgICAgICAvLyBJdCBoYXMgYSBzdXBlcmNsYXNzLlxuICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICB9XG4gICAgICAgIC8vIFBhc3MgdGhyb3VnaC5cbiAgICAgICAgLy8gVGhpcyBsb29rcyBsaWtlIGEgcmVndWxhciBmdW5jdGlvbiB3aXRoIGVtcHR5IHByb3RvdHlwZS5cbiAgICAgIH1cbiAgICAgIC8vIEZvciBwbGFpbiBmdW5jdGlvbnMgYW5kIGFycm93cywgdXNlIG5hbWUgYXMgYSBoZXVyaXN0aWMuXG4gICAgICBjb25zdCBuYW1lID0gdHlwZS5uYW1lIHx8IHR5cGUuZGlzcGxheU5hbWVcbiAgICAgIHJldHVybiB0eXBlb2YgbmFtZSA9PT0gJ3N0cmluZycgJiYgL15bQS1aXS8udGVzdChuYW1lKVxuICAgIH1cbiAgICBjYXNlICdvYmplY3QnOiB7XG4gICAgICBpZiAodHlwZSAhPSBudWxsKSB7XG4gICAgICAgIHN3aXRjaCAoZ2V0UHJvcGVydHkodHlwZSwgJyQkdHlwZW9mJykpIHtcbiAgICAgICAgICBjYXNlIFJFQUNUX0ZPUldBUkRfUkVGX1RZUEU6XG4gICAgICAgICAgY2FzZSBSRUFDVF9NRU1PX1RZUEU6XG4gICAgICAgICAgICAvLyBEZWZpbml0ZWx5IFJlYWN0IGNvbXBvbmVudHMuXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICAgIGRlZmF1bHQ6IHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBpc0NvbXBvdW5kQ29tcG9uZW50KHR5cGUpIHtcbiAgaWYgKCFpc1BsYWluT2JqZWN0KHR5cGUpKSByZXR1cm4gZmFsc2VcbiAgZm9yIChjb25zdCBrZXkgaW4gdHlwZSkge1xuICAgIGlmICghaXNMaWtlbHlDb21wb25lbnRUeXBlKHR5cGVba2V5XSkpIHJldHVybiBmYWxzZVxuICB9XG4gIHJldHVybiB0cnVlXG59XG5cbmZ1bmN0aW9uIGlzUGxhaW5PYmplY3Qob2JqKSB7XG4gIHJldHVybiAoXG4gICAgT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iaikgPT09ICdbb2JqZWN0IE9iamVjdF0nICYmXG4gICAgKG9iai5jb25zdHJ1Y3RvciA9PT0gT2JqZWN0IHx8IG9iai5jb25zdHJ1Y3RvciA9PT0gdW5kZWZpbmVkKVxuICApXG59XG5cbi8qKlxuICogUGx1Z2luIHV0aWxzXG4gKi9cblxuLy8gVGFrZW4gZnJvbSBodHRwczovL2dpdGh1Yi5jb20vcG1tbXdoL3JlYWN0LXJlZnJlc2gtd2VicGFjay1wbHVnaW4vYmxvYi9tYWluL2xpYi9ydW50aW1lL1JlZnJlc2hVdGlscy5qcyNMMTQxXG4vLyBUaGlzIGFsbG93cyB0byByZXNpc3RlciBjb21wb25lbnRzIG5vdCBkZXRlY3RlZCBieSBTV0MgbGlrZSBzdHlsZWQgY29tcG9uZW50XG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXJFeHBvcnRzRm9yUmVhY3RSZWZyZXNoKGZpbGVuYW1lLCBtb2R1bGVFeHBvcnRzKSB7XG4gIGZvciAoY29uc3Qga2V5IGluIG1vZHVsZUV4cG9ydHMpIHtcbiAgICBpZiAoa2V5ID09PSAnX19lc01vZHVsZScpIGNvbnRpbnVlXG4gICAgY29uc3QgZXhwb3J0VmFsdWUgPSBtb2R1bGVFeHBvcnRzW2tleV1cbiAgICBpZiAoaXNMaWtlbHlDb21wb25lbnRUeXBlKGV4cG9ydFZhbHVlKSkge1xuICAgICAgLy8gJ2V4cG9ydCcgaXMgcmVxdWlyZWQgdG8gYXZvaWQga2V5IGNvbGxpc2lvbiB3aGVuIHJlbmFtZWQgZXhwb3J0cyB0aGF0XG4gICAgICAvLyBzaGFkb3cgYSBsb2NhbCBjb21wb25lbnQgbmFtZTogaHR0cHM6Ly9naXRodWIuY29tL3ZpdGVqcy92aXRlLXBsdWdpbi1yZWFjdC9pc3N1ZXMvMTE2XG4gICAgICAvLyBUaGUgcmVnaXN0ZXIgZnVuY3Rpb24gaGFzIGFuIGlkZW50aXR5IGNoZWNrIHRvIG5vdCByZWdpc3RlciB0d2ljZSB0aGUgc2FtZSBjb21wb25lbnQsXG4gICAgICAvLyBzbyB0aGlzIGlzIHNhZmUgdG8gbm90IHVzZWQgdGhlIHNhbWUga2V5IGhlcmUuXG4gICAgICByZWdpc3RlcihleHBvcnRWYWx1ZSwgZmlsZW5hbWUgKyAnIGV4cG9ydCAnICsga2V5KVxuICAgIH0gZWxzZSBpZiAoaXNDb21wb3VuZENvbXBvbmVudChleHBvcnRWYWx1ZSkpIHtcbiAgICAgIGZvciAoY29uc3Qgc3ViS2V5IGluIGV4cG9ydFZhbHVlKSB7XG4gICAgICAgIHJlZ2lzdGVyKFxuICAgICAgICAgIGV4cG9ydFZhbHVlW3N1YktleV0sXG4gICAgICAgICAgZmlsZW5hbWUgKyAnIGV4cG9ydCAnICsga2V5ICsgJy0nICsgc3ViS2V5LFxuICAgICAgICApXG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGRlYm91bmNlKGZuLCBkZWxheSkge1xuICBsZXQgaGFuZGxlXG4gIHJldHVybiAoKSA9PiB7XG4gICAgY2xlYXJUaW1lb3V0KGhhbmRsZSlcbiAgICBoYW5kbGUgPSBzZXRUaW1lb3V0KGZuLCBkZWxheSlcbiAgfVxufVxuXG5jb25zdCBob29rcyA9IFtdXG53aW5kb3cuX19yZWdpc3RlckJlZm9yZVBlcmZvcm1SZWFjdFJlZnJlc2ggPSAoY2IpID0+IHtcbiAgaG9va3MucHVzaChjYilcbn1cbmNvbnN0IGVucXVldWVVcGRhdGUgPSBkZWJvdW5jZShhc3luYyAoKSA9PiB7XG4gIGlmIChob29rcy5sZW5ndGgpIGF3YWl0IFByb21pc2UuYWxsKGhvb2tzLm1hcCgoY2IpID0+IGNiKCkpKVxuICBwZXJmb3JtUmVhY3RSZWZyZXNoKClcbn0sIDE2KVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVSZWZyZXNoQm91bmRhcnlBbmRFbnF1ZXVlVXBkYXRlKFxuICBpZCxcbiAgcHJldkV4cG9ydHMsXG4gIG5leHRFeHBvcnRzLFxuKSB7XG4gIGNvbnN0IGlnbm9yZWRFeHBvcnRzID0gd2luZG93Ll9fZ2V0UmVhY3RSZWZyZXNoSWdub3JlZEV4cG9ydHM/Lih7IGlkIH0pID8/IFtdXG4gIGlmIChcbiAgICBwcmVkaWNhdGVPbkV4cG9ydChcbiAgICAgIGlnbm9yZWRFeHBvcnRzLFxuICAgICAgcHJldkV4cG9ydHMsXG4gICAgICAoa2V5KSA9PiBrZXkgaW4gbmV4dEV4cG9ydHMsXG4gICAgKSAhPT0gdHJ1ZVxuICApIHtcbiAgICByZXR1cm4gJ0NvdWxkIG5vdCBGYXN0IFJlZnJlc2ggKGV4cG9ydCByZW1vdmVkKSdcbiAgfVxuICBpZiAoXG4gICAgcHJlZGljYXRlT25FeHBvcnQoXG4gICAgICBpZ25vcmVkRXhwb3J0cyxcbiAgICAgIG5leHRFeHBvcnRzLFxuICAgICAgKGtleSkgPT4ga2V5IGluIHByZXZFeHBvcnRzLFxuICAgICkgIT09IHRydWVcbiAgKSB7XG4gICAgcmV0dXJuICdDb3VsZCBub3QgRmFzdCBSZWZyZXNoIChuZXcgZXhwb3J0KSdcbiAgfVxuXG4gIGxldCBoYXNFeHBvcnRzID0gZmFsc2VcbiAgY29uc3QgYWxsRXhwb3J0c0FyZUNvbXBvbmVudHNPclVuY2hhbmdlZCA9IHByZWRpY2F0ZU9uRXhwb3J0KFxuICAgIGlnbm9yZWRFeHBvcnRzLFxuICAgIG5leHRFeHBvcnRzLFxuICAgIChrZXksIHZhbHVlKSA9PiB7XG4gICAgICBoYXNFeHBvcnRzID0gdHJ1ZVxuICAgICAgaWYgKGlzTGlrZWx5Q29tcG9uZW50VHlwZSh2YWx1ZSkpIHJldHVybiB0cnVlXG4gICAgICBpZiAoaXNDb21wb3VuZENvbXBvbmVudCh2YWx1ZSkpIHJldHVybiB0cnVlXG4gICAgICByZXR1cm4gcHJldkV4cG9ydHNba2V5XSA9PT0gbmV4dEV4cG9ydHNba2V5XVxuICAgIH0sXG4gIClcbiAgaWYgKGhhc0V4cG9ydHMgJiYgYWxsRXhwb3J0c0FyZUNvbXBvbmVudHNPclVuY2hhbmdlZCA9PT0gdHJ1ZSkge1xuICAgIGVucXVldWVVcGRhdGUoKVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBgQ291bGQgbm90IEZhc3QgUmVmcmVzaCAoXCIke2FsbEV4cG9ydHNBcmVDb21wb25lbnRzT3JVbmNoYW5nZWR9XCIgZXhwb3J0IGlzIGluY29tcGF0aWJsZSkuIExlYXJuIG1vcmUgYXQgaHR0cHM6Ly9naXRodWIuY29tL3ZpdGVqcy92aXRlLXBsdWdpbi1yZWFjdC90cmVlL21haW4vcGFja2FnZXMvcGx1Z2luLXJlYWN0I2NvbnNpc3RlbnQtY29tcG9uZW50cy1leHBvcnRzYFxuICB9XG59XG5cbmZ1bmN0aW9uIHByZWRpY2F0ZU9uRXhwb3J0KGlnbm9yZWRFeHBvcnRzLCBtb2R1bGVFeHBvcnRzLCBwcmVkaWNhdGUpIHtcbiAgZm9yIChjb25zdCBrZXkgaW4gbW9kdWxlRXhwb3J0cykge1xuICAgIGlmIChpZ25vcmVkRXhwb3J0cy5pbmNsdWRlcyhrZXkpKSBjb250aW51ZVxuICAgIGlmICghcHJlZGljYXRlKGtleSwgbW9kdWxlRXhwb3J0c1trZXldKSkgcmV0dXJuIGtleVxuICB9XG4gIHJldHVybiB0cnVlXG59XG5cbi8vIEhpZGVzIHZpdGUtaWdub3JlZCBkeW5hbWljIGltcG9ydCBzbyB0aGF0IFZpdGUgY2FuIHNraXAgYW5hbHlzaXMgaWYgbm8gb3RoZXJcbi8vIGR5bmFtaWMgaW1wb3J0IGlzIHByZXNlbnQgKGh0dHBzOi8vZ2l0aHViLmNvbS92aXRlanMvdml0ZS9wdWxsLzEyNzMyKVxuZXhwb3J0IGNvbnN0IF9faG1yX2ltcG9ydCA9IChtb2R1bGUpID0+IGltcG9ydCgvKiBAdml0ZS1pZ25vcmUgKi8gX192aXRlX19pbmplY3RRdWVyeShtb2R1bGUsICdpbXBvcnQnKSlcblxuLy8gRm9yIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5IHdpdGggQHZpdGVqcy9wbHVnaW4tcmVhY3QuXG5leHBvcnQgZGVmYXVsdCB7IGluamVjdEludG9HbG9iYWxIb29rIH1cbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxNQUFNLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQ3JGLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDOztBQUU5RSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3pELENBQUMsQ0FBQztBQUNGLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsQ0FBQztBQUNsSSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxNQUFNO0FBQ3RELENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLFdBQVc7QUFDNUQsQ0FBQyxDQUFDOztBQUVGLEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUM7QUFDN0QsS0FBSyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUM7O0FBRS9DLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxZQUFZO0FBQ3JDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxLQUFLO0FBQy9ELEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUM7QUFDOUIsR0FBRyxDQUFDLGlCQUFpQixDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDO0FBQ3BDLEdBQUcsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQzs7QUFFdEMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUM7QUFDakQsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJO0FBQzlELEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQzs7QUFFMUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLENBQUMsSUFBSTtBQUN0RCxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTTtBQUM5QyxHQUFHLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDOztBQUV0QixDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxJQUFJO0FBQzVELEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQzs7QUFFcEMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQzs7QUFFOUIsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU87QUFDNUQsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQztBQUM3QixDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsSUFBSTtBQUN0RSxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDOztBQUU1QixDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUk7QUFDbkQsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsS0FBSztBQUM3RSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsT0FBTyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsUUFBUTtBQUMxRCxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxHQUFH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QUFDLEdBQUcsQ0FBQyxJQUFJO0FBQzVELENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUMzQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPO0FBQzdFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTztBQUNoRixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDSixDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxtQkFBbUI7QUFDNUQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxVQUFVLENBQUMsQ0FBQztBQUN4QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQztBQUM3QixDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ0osQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FB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QUFDdEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzVDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDO0FBQ3BELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxVQUFVO0FBQ2xELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQztBQUM5QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTTtBQUNoRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUMsTUFBTTtBQUNoRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQzs7QUFFdkIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxLQUFLO0FBQ25FLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLHVCQUF1QixDQUFDLFFBQVEsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7QUFDdkQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsTUFBTTtBQUNsQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO0FBQ2IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsTUFBTTtBQUNoQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQzs7QUFFTCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLFVBQVU7QUFDN0QsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztBQUNuQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQztBQUNsRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7QUFDOUMsQ0FBQyxDQUFDLENBQUMsQ0FBQzs7QUFFSixDQUFDLENBQUMsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLE9BQU8sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzdDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENB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QUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUM7QUFDOUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ1IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztBQUNsQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxNQUFNO0FBQzNCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDakMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ1IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDTixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztBQUNuQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDUixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsSUFBSTtBQUMzQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUM7QUFDVixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPO0FBQzFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUNwQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUN2QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7QUFDckIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDO0FBQ3ZCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxLQUFLO0FBQ2xDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMzQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxHQUFHLENBQUMsSUFBSTtBQUNwRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FB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QyxDQUFDLElBQUksQ0FBQyxLQUFLO0FBQ3JELENBQUMsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLEVBQUU7QUFDckMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDO0FBQzVCLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDO0FBQzdCLENBQUMsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxNQUFNO0FBQ2xDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO0FBQ1QsQ0FBQyxDQUFDLENBQUMsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDO0FBQ3RDLENBQUMsQ0FBQztBQUNGLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTTs7QUFFcEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUk7QUFDaEUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ2pELENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUMzQyxDQUFDLENBQUMs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QUksQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsSUFBSTs7QUFFdkYsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsU0FBUztBQUNuRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxFQUFFO0FBQ2pDLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUM7QUFDMUIsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDO0FBQzFCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTO0FBQ2pHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLENBQUMs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QUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUM3RSxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ0osQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNKLENBQUMsQ0FBQzs7QUFFRixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQyxlQUFlO0FBQzdELENBQUMsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7QUFDekIsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBQ3BDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxTQUFTO0FBQzlDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0FBQ1AsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7QUFDdEQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUTtBQUNyRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxPQUFPO0FBQzVDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxRQUFRO0FBQzFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDSixDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQztBQUNYLENBQUMsQ0FBQzs7QUFFRixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLEtBQUs7QUFDL0MsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsV0FBVztBQUM1RCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDO0FBQzlDLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzNDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0FBQ1AsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7QUFDdEQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUTtBQUNyRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FB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QUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPO0FBQ3BFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTztBQUM3RSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEdBQUc7O0FBRWpGLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQzlCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDO0FBQ3pCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUMzQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ25ELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxJQUFJOztBQUUvQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQztBQUN4QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDOztBQUU1RSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUM7QUFDdEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJO0FBQzdCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxJQUFJO0FBQy9CLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxJQUFJO0FBQ2pDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUM1QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLElBQUk7QUFDcEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsR0FBRztBQUNyRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUM3QyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLElBQUk7QUFDckMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLElBQUk7QUFDbEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUN4QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxLQUFLO0FBQy9DLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsSUFBSTtBQUNoQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7QUFDakIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBQyxJQUFJO0FBQ3JDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDVixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDO0FBQzlDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUM7QUFDeEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsS0FBSztBQUMvQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLElBQUk7QUFDaEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNWLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7QUFDYixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSTtBQUMzQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxJQUFJO0FBQzdCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQyxDQUFDLENBQUMsQ0FBQzs7QUFFSixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsSUFBSTtBQUM5QyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsU0FBUztBQUNyRCxDQUFDLENBQUM7QUFDRjs7QUFFQSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsU0FBUztBQUN4RSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLE9BQU87QUFDekUsQ0FBQztBQUNELENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ25FLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLG1DQUFtQyxDQUFDO0FBQ2hELENBQUM7QUFDRCxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztBQUNwQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7QUFDdEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFDO0FBQ2xDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJO0FBQzdFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQztBQUN2RSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVE7QUFDeEUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7QUFDckMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUM7QUFDdkIsQ0FBQyxDQUFDLENBQUM7QUFDSCxDQUFDO0FBQ0QsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0FBQy9ELENBQUMsQ0FBQyxDQUFDLEVBQUU7QUFDTCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSztBQUNWLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDakMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBQ3pFLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDSixNQUFNLENBQUMsUUFBUSxDQUFDLG1DQUFtQyxDQUFDLENBQUMsQ0FBQztBQUN0RCxDQUFDLENBQUMsR0FBRyxDQUFDO0FBQ04sQ0FBQyxDQUFDLEdBQUcsQ0FBQztBQUNOLENBQUMsQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQztBQUN4QixDQUFDLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDO0FBQzFELENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztBQUNqQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDO0FBQ3BELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUM7QUFDOUQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDbEUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUN0QixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLElBQUk7QUFDbEUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQztBQUNoRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQztBQUNwQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRO0FBQzVELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7QUFDN0QsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFDMUQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBSztBQUNyRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7QUFDVCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ3RCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQztBQUMvRCxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDUixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLFVBQVUs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Q0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7QUFDbEUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsS0FBSztBQUNwQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQztBQUNqQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7O0FBRVIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDO0FBQzNELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsVUFBVTtBQUNoQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQztBQUNqQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDUixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE9BQU87QUFDdkIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUztBQUNsRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNOLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsU0FBUztBQUNoRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQztBQUNyQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUk7QUFDM0QsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNKLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztBQUNuQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDeEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDL0MsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsc0JBQXNCO0FBQ3JDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGVB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QUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsYUFBYSxDQUFDLENBQUM7QUFDbkMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7QUFDOUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsR0FBRztBQUN6QyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLHFCQUFxQixDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7QUFDNUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQztBQUMxRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUM7QUFDM0YsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVM7QUFDN0YsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUk7QUFDdEQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUc7QUFDdkQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDLG1CQUFtQixDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7QUFDakQsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLENBQUM7QUFDeEMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVE7QUFDaEIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFDO0FBQzdCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNO0FBQ3BELENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNSLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNKLENBQUMsQ0FBQztBQUNGOztBQUVBLFFBQVEsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7QUFDN0IsQ0FBQyxDQUFDLEdB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
// Entry of the self-contained delivery builds (beacon.min.js IIFE `NowoBeacon`, beacon.esm.min.js): everything,
// including the <beacon-reporter> element and the IndexedDB queue.
export * from './index.js';
export { BeaconReporter, defineBeaconReporter } from './element-define.js';
export { indexedDbQueue } from './offline.js';

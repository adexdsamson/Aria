import { runRoutingOffline } from './routing.bench.ts';
const r = runRoutingOffline(3);
console.log('offline OK: pii=' + r.piiDetected + ' benignFP=' + r.benignFalsePositive);

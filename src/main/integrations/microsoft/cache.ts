import type { ICachePlugin, PublicClientApplication } from '@azure/msal-node';
import { Configuration, PublicClientApplication as Pca } from '@azure/msal-node';
import { getProviderTokens, setProviderTokens } from '../../secrets/safeStorage';

function cacheKey(accountId: string): string {
  return `microsoft:${accountId}`;
}

export function createSafeStorageCachePlugin(accountId: string): ICachePlugin {
  return {
    async beforeCacheAccess(tokenCacheContext) {
      const blob = getProviderTokens(cacheKey(accountId));
      if (blob) {
        tokenCacheContext.tokenCache.deserialize(blob);
      }
    },
    async afterCacheAccess(tokenCacheContext) {
      if (!tokenCacheContext.cacheHasChanged) return;
      setProviderTokens(cacheKey(accountId), tokenCacheContext.tokenCache.serialize());
    },
  };
}

export function createMicrosoftPca(accountId: string, config: Configuration): PublicClientApplication {
  return new Pca({
    ...config,
    cache: {
      ...(config.cache ?? {}),
      cachePlugin: createSafeStorageCachePlugin(accountId),
    },
  });
}

export function readMicrosoftCache(accountId: string): string | null {
  return getProviderTokens(cacheKey(accountId));
}

export function writeMicrosoftCache(accountId: string, blob: string): void {
  setProviderTokens(cacheKey(accountId), blob);
}

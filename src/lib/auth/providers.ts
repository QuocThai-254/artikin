/**
 * OAuth providers that can be enabled through environment variables (PROJECT F11, ARCHITECTURE §7).
 * A provider is enabled only when both its client id and secret are set; the sign-in UI asks the
 * server (`getEnabledSocialProviders`) instead of guessing. Server-only in practice (reads secrets),
 * but free of Better Auth imports so pages can call it cheaply.
 */

export const SOCIAL_PROVIDER_IDS = ["github", "google"] as const;

export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number];

export interface SocialProviderCredentials {
  clientId: string;
  clientSecret: string;
}

export type SocialProviderEnv = Record<string, string | undefined>;

const ENV_PREFIX: Record<SocialProviderId, string> = { github: "GITHUB", google: "GOOGLE" };

/** Credentials of every configured provider (both variables set and non-blank). */
export function getSocialProviderCredentials(
  env: SocialProviderEnv = process.env,
): Partial<Record<SocialProviderId, SocialProviderCredentials>> {
  const credentials: Partial<Record<SocialProviderId, SocialProviderCredentials>> = {};
  for (const provider of SOCIAL_PROVIDER_IDS) {
    const clientId = env[`${ENV_PREFIX[provider]}_CLIENT_ID`]?.trim();
    const clientSecret = env[`${ENV_PREFIX[provider]}_CLIENT_SECRET`]?.trim();
    if (clientId && clientSecret) credentials[provider] = { clientId, clientSecret };
  }
  return credentials;
}

/** Ids of the OAuth providers the server has credentials for, e.g. `["github"]`. */
export function getEnabledSocialProviders(
  env: SocialProviderEnv = process.env,
): SocialProviderId[] {
  const credentials = getSocialProviderCredentials(env);
  return SOCIAL_PROVIDER_IDS.filter((provider) => credentials[provider] !== undefined);
}

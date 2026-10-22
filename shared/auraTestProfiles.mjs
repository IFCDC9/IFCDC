/** Trusted, fixed test scopes. Packages cannot choose executable commands. */
export const GRANT_NAV_PROFILE = 'grant-subnav-v1';
export const GRANT_NAV_PATH = 'client/src/components/hq/grants/GrantSubNav.tsx';
export function applicationTestScope(changePackage) {
  return changePackage?.files?.length === 1 && changePackage.files[0].path === GRANT_NAV_PATH &&
    typeof changePackage.files[0].beforeSha256 === 'string';
}

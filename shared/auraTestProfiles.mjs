/** Trusted, fixed test scopes. Packages cannot choose executable commands. */
export const GRANT_NAV_PROFILE = 'grant-subnav-v1';
export const GRANT_NAV_PATH = 'client/src/components/hq/grants/GrantSubNav.tsx';
export function applicationTestScope(changePackage) {
  return changePackage?.files?.length === 1 && changePackage.files[0].path === GRANT_NAV_PATH &&
    typeof changePackage.files[0].beforeSha256 === 'string';
}

export const CHECKOUT_PROFILE = 'checkout-sandbox-v1';
export const CHECKOUT_PATH = 'script/ifcdc-checkout-pilot/paypal.mjs';
export const CHECKOUT_TEST_PATH = 'script/ifcdc-checkout-pilot/checkout.test.mjs';
export function checkoutTestScope(changePackage) {
  const files = changePackage?.files;
  return Array.isArray(files) && files.length === 2 &&
    [CHECKOUT_PATH, CHECKOUT_TEST_PATH].every(target => files.filter(file => file.path === target).length === 1);
}
export function supportedApplicationScope(changePackage, profile) {
  return profile === GRANT_NAV_PROFILE ? applicationTestScope(changePackage) :
    profile === CHECKOUT_PROFILE && checkoutTestScope(changePackage);
}

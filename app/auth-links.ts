// Production sign-in is handled by Cloudflare Access in front of the site: any
// network navigation shows its login page. The service worker answers a bare "/"
// from cache, so the root link carries a query string to reach the network.
// Local development keeps the loopback mock sign-in.
const dev=process.env.NODE_ENV==='development';
export function signInHref(returnTo='/'){
 if(dev)return '/signin-with-chatgpt?return_to='+encodeURIComponent(returnTo);
 return returnTo==='/'?'/?login':returnTo;
}
export const signOutHref=dev?'/signout-with-chatgpt?return_to=/':'/cdn-cgi/access/logout';

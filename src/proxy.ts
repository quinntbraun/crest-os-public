import {NextResponse} from 'next/server';
import type {NextRequest} from 'next/server';
import {createDocumentPolicy} from './security/document-policy.ts';

// Header policy only. Authentication, CSRF, admission and authorization belong in routes.
// Run even on prefetch/error/API requests so caller-controlled headers cannot skip it.
export function proxy(request:NextRequest){
  const {nonce,policy}=createDocumentPolicy(process.env.NODE_ENV==='development'?'development':'production');
  const headers=new Headers(request.headers);
  headers.delete('x-nonce');headers.delete('content-security-policy-report-only');
  headers.set('x-crest-nonce',nonce);headers.set('content-security-policy',policy);
  const response=NextResponse.next({request:{headers}});
  response.headers.set('Content-Security-Policy',policy);
  // Framework static resources carry no private records. Preserve Next's own
  // immutable asset caching; unknown static paths still receive fresh policy.
  if(!request.nextUrl.pathname.startsWith('/_next/static/')){
    response.headers.set('Cache-Control','private, no-store, max-age=0');
    response.headers.set('CDN-Cache-Control','no-store');
    response.headers.set('Surrogate-Control','no-store');
    response.headers.set('Pragma','no-cache');response.headers.set('Expires','0');
  }
  return response;
}

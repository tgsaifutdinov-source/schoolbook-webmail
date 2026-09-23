const securityHeaders=[
 {key:"X-Content-Type-Options",value:"nosniff"},
 {key:"X-Frame-Options",value:"DENY"},
 {key:"Referrer-Policy",value:"no-referrer"},
 {key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=(), payment=(), usb=()"},
 {key:"Cross-Origin-Opener-Policy",value:"same-origin"},
 {key:"Strict-Transport-Security",value:"max-age=31536000"},
 {key:"Content-Security-Policy",value:"frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'"}
];
const nextConfig={
 async headers(){
  return [{source:"/(.*)",headers:securityHeaders}];
 }
};
export default nextConfig;

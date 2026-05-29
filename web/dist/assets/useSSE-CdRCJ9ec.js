import{m as g}from"./index-CJYjPQo4.js";function T(){const n=g(!1);let t=null;async function u(p,h,i,w="POST"){var c;t=new AbortController,n.value=!0;let r="";try{const s=await fetch(p,{method:w,headers:{"Content-Type":"application/json"},body:JSON.stringify(h),signal:t.signal});if(!s.ok){const e=await s.text();throw new Error(e||`HTTP ${s.status}`)}const l=(c=s.body)==null?void 0:c.getReader();if(!l)throw new Error("No response body");const y=new TextDecoder;for(;;){const{done:e,value:o}=await l.read();if(e)break;r+=y.decode(o,{stream:!0});const f=r.split(`

`);r=f.pop()||"";for(const b of f){const S=b.split(`
`);for(const a of S)if(!a.startsWith(": ")&&a.startsWith("data: "))try{const m=JSON.parse(a.slice(6));i(m)}catch{}}}if(r.trim()){for(const e of r.split(`
`))if(e.startsWith("data: "))try{const o=JSON.parse(e.slice(6));i(o)}catch{}}}finally{n.value=!1,t=null}}function d(){t==null||t.abort(),n.value=!1}return{isStreaming:n,start:u,abort:d}}export{T as u};

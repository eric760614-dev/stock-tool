const ALLOWED_MAP_HOSTS = /^(?:maps\.app\.goo\.gl|goo\.gl|(?:www\.)?google\.[a-z.]+|maps\.google\.[a-z.]+)$/i;
function validMapUrl(value){
  try{const u=new URL(value);return u.protocol==='https:'&&ALLOWED_MAP_HOSTS.test(u.hostname)&&(/\/maps(?:\/|$)/.test(u.pathname)||u.hostname==='maps.app.goo.gl');}catch{return false}
}
function decodeEntities(value){return value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&#x27;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>')}
function extractMapName(html,finalUrl){
  const tags=[...html.matchAll(/<meta\s+[^>]*>/gi)].map(m=>m[0]);
  let title='';
  for(const tag of tags){
    if(/(?:property|name)\s*=\s*["'](?:og:title|twitter:title)["']/i.test(tag)){
      title=tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1]||'';if(title)break;
    }
  }
  if(!title)title=html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]||'';
  title=decodeEntities(title).replace(/\s*[-–|]\s*Google\s*(?:Maps|地圖).*$/i,'').trim();
  if(!title||/^(Google Maps|Google 地圖|Google 地图|Google)$/i.test(title)){
    try{const u=new URL(finalUrl);const match=u.pathname.match(/\/maps\/place\/([^/]+)/);if(match)title=decodeURIComponent(match[1].replace(/\+/g,' '));}catch{}
  }
  return title&&title.length<150&&!/^Google Maps/i.test(title)?title:'';
}
export default {
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==='/api/maps/resolve'){
      const original=u.searchParams.get('url')||'';
      if(original.length>2000||!validMapUrl(original))return Response.json({name:null,error:'invalid url'},{status:400});
      const cache=await caches.default.match(request);if(cache)return cache;
      try{
        // Follow Google redirects only; never send the user's note or other data.
        const res=await fetch(original,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (compatible; BudgetTool/1.0)','Accept':'text/html'}});
        if(!validMapUrl(res.url))return Response.json({name:null});
        const html=(await res.text()).slice(0,400000);
        const name=extractMapName(html,res.url);
        const output=Response.json({name:name||null},{headers:{'Cache-Control':'public, max-age=86400'}});
        if(name)ctx.waitUntil(caches.default.put(request,output.clone()));
        return output;
      }catch{return Response.json({name:null});}
    }
    return env.ASSETS.fetch(request);
  }
};

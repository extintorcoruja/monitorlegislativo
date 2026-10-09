import { unzipSync } from "fflate";

export const runtime = "nodejs";
export const maxDuration = 60;

const ZIP_URL = "https://www.al.sp.gov.br/repositorioDados/processo_legislativo/proposituras.zip";

function clean(value: unknown): string { return String(value == null ? "" : value).replace(/\s+/g, " ").trim(); }
function norm(value: unknown): string { return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }

function xmlTag(xml: string, names: string[]): string {
  for (const name of names) {
    const m = xml.match(new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+name+">","i"));
    if (m) return clean(m[1]).replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  }
  return "";
}

function dateToIso(value: string): string {
  const v=clean(value);
  let m=v.match(/(\d{4})[-/](\d{2})[-/](\d{2})/); if(m) return m[1]+"-"+m[2]+"-"+m[3];
  m=v.match(/(\d{2})[-/](\d{2})[-/](\d{4})/); if(m) return m[3]+"-"+m[2]+"-"+m[1];
  return "";
}

function parseBlock(block:string, keywords:any[], startDate:string) {
  const id=xmlTag(block,["IdDocumento","IdPropositura","Codigo","idDocumento","idPropositura"]); if(!id) return null;
  const entered=dateToIso(xmlTag(block,["DtEntradaSistema","DataEntrada","DtEntrada"]));
  const year=clean(xmlTag(block,["AnoLegislativo","Ano","AnoPropositura","ano"]));
  if(entered && entered<startDate) return null;
  if(!entered && /^\d{4}$/.test(year) && year<startDate.slice(0,4)) return null;
  const text=norm(block), matched:string[]=[]; let score=0;
  for(const k of keywords){ const term=norm(k.termo); if(term && text.includes(term)){matched.push(k.termo);score+=Number(k.peso||5);} }
  if(!matched.length) return null;
  const type=xmlTag(block,["SiglaNatureza","Natureza","Tipo","SiglaTipo","DescricaoNatureza","DescricaoTipo"]);
  const numberText=xmlTag(block,["NroLegislativo","Numero","NumeroPropositura","numero"]);
  const ementa=xmlTag(block,["Ementa","DescricaoEmenta","Descricao","ementa"]);
  const author=xmlTag(block,["Autor","NomeAutor","autor"]);
  const title=ementa||xmlTag(block,["Titulo","DescricaoPropositura"]);
  return {
    verification_id:null, source_code:"alesp", source_label:"ALESP", official_id:String(id),
    type:clean(type), number_text:clean(numberText), year_text:clean(year), title:clean(title),
    ementa:clean(ementa), author_text:clean(author),
    official_url:"https://www.al.sp.gov.br/propositura/?id="+encodeURIComponent(id),
    matched_terms:matched, score,
    raw:{IdDocumento:id,Tipo:type,NroLegislativo:numberText,AnoLegislativo:year,Ementa:ementa,Autor:author,DtEntradaSistema:entered}
  };
}

async function rpc(fn:string,args:unknown[]){
  const base=process.env.NEXT_PUBLIC_SUPABASE_URL;
  if(!base) throw new Error("Supabase não configurado.");
  const r=await fetch(process.env.SUPABASE_FUNCTION_URL || base.replace(/\/$/,"")+"/functions/v1/monitor-rpc",{
    method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",body:JSON.stringify({fn,args})
  });
  const p=await r.json().catch(()=>null);
  if(!r.ok||!p?.ok) throw new Error(String(p?.message||"Erro ao consultar o backend."));
  return p.data;
}

export async function POST(request:Request){
  try{
    const body=await request.json();
    const token=clean(body?.token), verificationId=clean(body?.verificationId), responsible=clean(body?.responsible);
    if(!token||!verificationId) return Response.json({ok:false,message:"Sessão ou verificação não informada."},{status:400});
    const keywords=await rpc("getPalavras",[token]);
    if(!Array.isArray(keywords)||!keywords.length) throw new Error("Nenhum termo de apoio ativo.");
    const startDate=String(await rpc("getInicioPesquisaAutomatica",[token,"ALESP"]));
    const response=await fetch(ZIP_URL,{headers:{accept:"application/zip, application/octet-stream","user-agent":"MonitorLegislativo/1.0"},cache:"no-store"});
    if(!response.ok) throw new Error("ALESP: HTTP "+response.status+" ao baixar proposituras.zip");
    const files=unzipSync(new Uint8Array(await response.arrayBuffer()));
    const fileNames=Object.keys(files);
    let fileName=fileNames.find(name=>(/(^|[\\/])proposituras?\.xml$/i).test(name.trim()));
    if(!fileName) fileName=fileNames.find(name=>/\.xml$/i.test(name)&&/propositur/i.test(name));
    if(!fileName) throw new Error("ALESP: XML de proposituras não identificado no ZIP. Arquivos encontrados: "+fileNames.slice(0,20).join(", "));
    const xml=new TextDecoder("utf-8").decode(files[fileName]);
    const rows=new Map<string,any>();
    const diagnostics={
      startDate,
      endDate:new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo"}).format(new Date()),
      zipFile:fileName,
      xmlBytes:xml.length,
      propositurasLidas:0,
      registrosNoPeriodo:0,
      correspondencias:0
    };
    const re=/<propositura(?:\s[^>]*)?>([\s\S]*?)<\/propositura>/gi;
    let match:RegExpExecArray|null;
    while((match=re.exec(xml))!==null){
      diagnostics.propositurasLidas++;
      const item=parseBlock(match[1],keywords,startDate);
      if(!item) {
        const entered=dateToIso(xmlTag(match[1],["DtEntradaSistema","DataEntrada","DtEntrada"]));
        const year=clean(xmlTag(match[1],["AnoLegislativo","Ano","AnoPropositura","ano"]));
        if((entered && entered>=startDate)||(!entered&&/^\\d{4}$/.test(year)&&year>=startDate.slice(0,4))) {
          diagnostics.registrosNoPeriodo++;
        }
        continue;
      }
      diagnostics.registrosNoPeriodo++;
      const existing=rows.get(item.official_id);
      if(existing){item.matched_terms=Array.from(new Set(existing.matched_terms.concat(item.matched_terms)));item.score=Math.max(existing.score,item.score);}
      rows.set(item.official_id,item);
    }
    diagnostics.correspondencias=rows.size;
    if(diagnostics.propositurasLidas===0){
      throw new Error("ALESP: o XML foi localizado, mas nenhuma propositura foi lida. Consulta não validada.");
    }
    const providerResponse={
      results:Array.from(rows.values()).map(item=>({...item,verification_id:verificationId})),
      errors:[],
      startDate,
      endDate:diagnostics.endDate,
      diagnostico:diagnostics
    };
    return Response.json(await rpc("salvarResultadosPesquisaAutomatica",[token,verificationId,"ALESP",responsible,providerResponse]));
  }catch(error){
    return Response.json({ok:false,message:error instanceof Error?error.message:String(error)},{status:400});
  }
}

import io, json, os, sys, urllib.request, zipfile
import xml.etree.ElementTree as ET

ZIP_URL='https://www.al.sp.gov.br/repositorioDados/processo_legislativo/documento_regime.zip'
CALLBACK_URL=os.environ.get('ALESP_CALLBACK_URL','')

def norm_tag(tag):
    return tag.split('}',1)[-1].lower().replace('_','').replace('-','')

def parse_date_key(s):
    s=(s or '').strip()
    # ISO e datas brasileiras simples ordenam razoavelmente com fallback textual
    digits=''.join(ch for ch in s if ch.isdigit())
    if len(digits)>=8 and '/' in s:
        # dd/mm/yyyy -> yyyymmdd
        try:
            d,m,y=s[:10].split('/')
            return y+m+d+s[10:]
        except Exception:
            pass
    return s

def choose(current,cand):
    if current is None:
        return cand
    if cand['ativo'] and not current['ativo']:
        return cand
    if cand['ativo']==current['ativo'] and parse_date_key(cand['dataInicio'])>parse_date_key(current['dataInicio']):
        return cand
    return current

def main():
    ids={x.strip() for x in os.environ.get('ALESP_IDS','').split(',') if x.strip()}
    request_id=os.environ.get('REQUEST_ID','')
    secret=os.environ.get('INTEGRATION_SECRET','')
    if not ids:
        raise SystemExit('Nenhum ID ALESP recebido.')
    if not secret:
        raise SystemExit('Secret INTEGRATION_SECRET ausente.')
    if not CALLBACK_URL:
        raise SystemExit('Secret ALESP_CALLBACK_URL ausente.')

    req=urllib.request.Request(ZIP_URL,headers={'User-Agent':'Monitor-Legislativo/1.0'})
    with urllib.request.urlopen(req,timeout=120) as r:
        raw=r.read()
    print(f'ZIP baixado: {len(raw)/1024/1024:.2f} MB')

    found={}
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        names=z.namelist()
        xml_name=next((n for n in names if n.lower().endswith('.xml')),names[0])
        print('XML:',xml_name)
        with z.open(xml_name) as fh:
            for event,elem in ET.iterparse(fh,events=('end',)):
                if norm_tag(elem.tag)!='documentoregime':
                    continue
                vals={}
                for ch in list(elem):
                    vals[norm_tag(ch.tag)]=(ch.text or '').strip()
                iddoc=vals.get('iddocumento','')
                if iddoc in ids:
                    nome=vals.get('nomeregime') or vals.get('regime') or ''
                    ini=vals.get('datainicio','')
                    fim=vals.get('datafim','')
                    if nome:
                        cand={'idDocumento':iddoc,'nomeRegime':nome,'dataInicio':ini,'dataFim':fim,'ativo':not bool(fim)}
                        found[iddoc]=choose(found.get(iddoc),cand)
                elem.clear()

    regimes=[]
    for iddoc in sorted(found):
        x=found[iddoc].copy();x.pop('ativo',None);regimes.append(x)
    payload=json.dumps({
        'action':'alesp_regimes_result','secret':secret,'requestId':request_id,
        'regimes':regimes,'meta':{'solicitados':len(ids),'localizados':len(regimes),'fonte':'documento_regime.zip'}
    },ensure_ascii=False).encode('utf-8')
    print(f'Localizados {len(regimes)} de {len(ids)} IDs solicitados.')

    req=urllib.request.Request(CALLBACK_URL,data=payload,headers={'Content-Type':'application/json','User-Agent':'Monitor-Legislativo/1.0'},method='POST')
    with urllib.request.urlopen(req,timeout=60) as r:
        body=r.read().decode('utf-8','replace')
        print('Callback HTTP',r.status,body[:500])
        if r.status<200 or r.status>=300:
            raise SystemExit('Callback falhou.')
        try:
            obj=json.loads(body)
        except Exception:
            raise SystemExit('Callback não retornou JSON; verifique se o Web App aceita acesso anônimo.')
        if not obj.get('ok'):
            raise SystemExit('Callback rejeitado: '+str(obj))

if __name__=='__main__':
    main()

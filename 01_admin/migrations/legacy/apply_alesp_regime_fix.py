from pathlib import Path
import re

code_path = Path('Code.gs')
index_path = Path('Index.html')

code = code_path.read_text(encoding='utf-8')
index = index_path.read_text(encoding='utf-8')

# 1) Enriquecer o endpoint público de atualização de regimes.
code = re.sub(
    r"function atualizarRegimesAlesp\(token\)\{.*?\n\}",
    """function atualizarRegimesAlesp(token){
  validarSessao_(token);
  var props=getRows_(getDb_(),'PROPOSITURAS').filter(function(p){
    return p.fonte==='ALESP' && String(p.status||'')!=='Arquivar';
  });
  PropertiesService.getScriptProperties().deleteProperty('REGIME_ALESP_ATUALIZADO_EM');
  var r=atualizarRegimesAlespInterno_(props);
  return serializar_({
    ok:true,
    previstos:Number(r.previstos||props.length),
    localizados:Number(r.localizados||0),
    atualizados:Number(r.atualizados||0),
    semRegime:Number(r.semRegime||0),
    faltantes:r.faltantes||[],
    cache:!!r.cache
  });
}""",
    code,
    count=1,
    flags=re.S,
)

# 2) Substituir a rotina pesada/ineficiente por leitura única + gravação em lote.
new_internal = r'''function atualizarRegimesAlespInterno_(props){
  props=props||[];
  if(!props.length) return {ok:true,previstos:0,localizados:0,atualizados:0,semRegime:0,faltantes:[]};

  var sp=PropertiesService.getScriptProperties();
  var hoje=fmtDate_(new Date());
  if(String(sp.getProperty('REGIME_ALESP_ATUALIZADO_EM')||'')===hoje){
    return {ok:true,previstos:props.length,localizados:0,atualizados:0,semRegime:0,faltantes:[],cache:true};
  }

  var ids={};
  props.forEach(function(p){
    var id=String(p.idAlesp||p.idOficial||'').trim();
    if(id) ids[id]=p;
  });

  var resp=null,ultimoErro=null;
  for(var tentativa=1;tentativa<=2;tentativa++){
    try{
      resp=UrlFetchApp.fetch(CFG.ALESP_REGIME_ZIP,{
        muteHttpExceptions:true,
        headers:{Accept:'application/zip,*/*'}
      });
      var status=resp.getResponseCode();
      if(status>=200&&status<300) break;
      ultimoErro=new Error('Regime ALESP HTTP '+status);
      resp=null;
    }catch(e){ultimoErro=e;resp=null;}
    if(tentativa<2) Utilities.sleep(900);
  }
  if(!resp) throw ultimoErro||new Error('Não foi possível baixar a base de regimes da ALESP.');

  var blobs=Utilities.unzip(resp.getBlob());
  if(!blobs||!blobs.length) throw new Error('ZIP de regimes ALESP vazio.');

  var xmlBlob=blobs.find(function(b){return /\.xml$/i.test(String(b.getName()||''));})||blobs[0];
  var xml=xmlBlob.getDataAsString('UTF-8');

  var encontrados={};
  var re=/<DocumentoRegime>([\s\S]*?)<\/DocumentoRegime>/gi,m;
  while((m=re.exec(xml))!==null){
    var block=m[1];
    var id=String(tag_(block,'IdDocumento')||'').trim();
    if(!id||!ids[id]) continue;

    var nome=normalizar_(tag_(block,'NomeRegime')||'');
    var ini=tag_(block,'DataInicio')||'';
    var fim=tag_(block,'DataFim')||'';
    if(!nome) continue;

    var cand={nome:nome,inicio:ini,fim:fim,ativo:!String(fim).trim()};
    var atual=encontrados[id];
    if(!atual || (cand.ativo&&!atual.ativo) ||
       (cand.ativo===atual.ativo && toTime_(cand.inicio)>toTime_(atual.inicio))){
      encontrados[id]=cand;
    }
  }

  // Gravação em lote: evita dezenas de leituras/escritas na planilha.
  var sh=getDb_().getSheetByName('PROPOSITURAS');
  if(!sh||sh.getLastRow()<2) throw new Error('Aba PROPOSITURAS não encontrada.');
  var data=sh.getDataRange().getValues();
  var h=data[0].map(String);
  function c(n){return h.indexOf(n);}
  var cFonte=c('fonte'),cId=c('idOficial'),cIdAlesp=c('idAlesp'),cReg=c('regimeTramitacao'),cData=c('dataRegime');
  if(cReg<0||cData<0) throw new Error('Campos regimeTramitacao/dataRegime não existem. Execute prepararBancoV67().');

  var valsReg=[],valsData=[],atualizados=0,localizados=0;
  for(var r=1;r<data.length;r++){
    var regAtual=data[r][cReg]||'';
    var dataAtual=data[r][cData]||'';
    if(String(data[r][cFonte]||'')==='ALESP'){
      var idLinha=String((cIdAlesp>=0?data[r][cIdAlesp]:'') || (cId>=0?data[r][cId]:'') || '').trim();
      var achado=encontrados[idLinha];
      if(achado){
        localizados++;
        if(String(regAtual)!==String(achado.nome)||String(dataAtual)!==String(achado.inicio||'')) atualizados++;
        regAtual=achado.nome;
        dataAtual=achado.inicio||'';
      }
    }
    valsReg.push([regAtual]);
    valsData.push([dataAtual]);
  }
  if(valsReg.length){
    sh.getRange(2,cReg+1,valsReg.length,1).setValues(valsReg);
    sh.getRange(2,cData+1,valsData.length,1).setValues(valsData);
  }

  var faltantes=[];
  props.forEach(function(p){
    var id=String(p.idAlesp||p.idOficial||'').trim();
    if(id && !encontrados[id] && faltantes.length<8) faltantes.push(labelProp_(p));
  });

  sp.setProperty('REGIME_ALESP_ATUALIZADO_EM',hoje);
  return {
    ok:true,
    previstos:props.length,
    localizados:localizados,
    atualizados:atualizados,
    semRegime:Math.max(0,props.length-localizados),
    faltantes:faltantes
  };
}'''

code, n = re.subn(
    r"function atualizarRegimesAlespInterno_\(props\)\{.*?\n\}\n\nfunction verificarAlesp",
    new_internal + "\n\nfunction verificarAlesp",
    code,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit('Não foi possível localizar atualizarRegimesAlespInterno_.')

# 3) Botão visível na tela de Proposituras.
old_panel = "<div class=\"panel\"><div class=\"panel-head\"><div><h2>Proposituras monitoradas</h2><p class=\"intro\">Matérias incluídas no acompanhamento automático.</p></div></div><div class=\"toolbar\">"
new_panel = "<div class=\"panel\"><div class=\"panel-head\"><div><h2>Proposituras monitoradas</h2><p class=\"intro\">Matérias incluídas no acompanhamento automático.</p></div><button class=\"secondary\" onclick=\"atualizarRegimesAlespUI(this)\">↻ Atualizar regimes ALESP</button></div><div class=\"toolbar\">"
if old_panel not in index:
    raise SystemExit('Cabeçalho da tela Proposituras não encontrado.')
index = index.replace(old_panel, new_panel, 1)

# 4) Corrigir a chave de cache e mostrar resultado mais útil.
index = index.replace("invalidate('proposicoes');", "invalidate('proposituras');", 1)
old_toast = "toast('Regimes ALESP atualizados: '+Number(r.atualizados||0)+'.');"
new_toast = "toast('Regimes ALESP: '+Number(r.localizados||0)+' de '+Number(r.previstos||0)+' localizados; '+Number(r.atualizados||0)+' atualizado(s).');"
index = index.replace(old_toast, new_toast, 1)

# 5) Texto menos ambíguo para quem ainda não executou a atualização.
index = index.replace("x.regimeTramitacao||'Regime não carregado'", "x.regimeTramitacao||'Aguardando atualização do regime'", 1)

code_path.write_text(code, encoding='utf-8')
index_path.write_text(index, encoding='utf-8')
print('Correção ALESP aplicada com sucesso.')

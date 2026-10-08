from pathlib import Path
import re

code_path = Path('Code.gs')
index_path = Path('Index.html')
code = code_path.read_text(encoding='utf-8')
index = index_path.read_text(encoding='utf-8')

# ---- Backend: endpoint de callback + disparo/polling do GitHub Actions ----
bridge = r'''
function doPost(e){
  try{
    var body={};
    try{ body=JSON.parse((e&&e.postData&&e.postData.contents)||'{}'); }catch(parseErr){
      return ContentService.createTextOutput(JSON.stringify({ok:false,error:'JSON inválido'})).setMimeType(ContentService.MimeType.JSON);
    }
    if(String(body.action||'')!=='alesp_regimes_result'){
      return ContentService.createTextOutput(JSON.stringify({ok:false,error:'Ação inválida'})).setMimeType(ContentService.MimeType.JSON);
    }
    var esperado=PropertiesService.getScriptProperties().getProperty('INTEGRATION_SECRET')||'';
    if(!esperado || String(body.secret||'')!==String(esperado)){
      return ContentService.createTextOutput(JSON.stringify({ok:false,error:'Não autorizado'})).setMimeType(ContentService.MimeType.JSON);
    }
    var resultado=aplicarRegimesAlespRecebidos_(body.requestId||'',body.regimes||[],body.meta||{});
    return ContentService.createTextOutput(JSON.stringify(resultado)).setMimeType(ContentService.MimeType.JSON);
  }catch(err){
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:String(err&&err.message||err)})).setMimeType(ContentService.MimeType.JSON);
  }
}

function aplicarRegimesAlespRecebidos_(requestId,regimes,meta){
  if(!Array.isArray(regimes)) throw new Error('Lista de regimes inválida.');
  var porId={};
  regimes.forEach(function(r){
    var id=String(r.idDocumento||r.id||'').trim();
    var nome=normalizar_(r.nomeRegime||r.regime||'');
    if(id&&nome) porId[id]={nome:nome,inicio:String(r.dataInicio||''),fim:String(r.dataFim||'')};
  });

  var sh=getDb_().getSheetByName('PROPOSITURAS');
  if(!sh||sh.getLastRow()<2) throw new Error('Aba PROPOSITURAS não encontrada.');
  var data=sh.getDataRange().getValues();
  var h=data[0].map(String);
  function c(n){return h.indexOf(n);}
  var cFonte=c('fonte'),cId=c('idOficial'),cIdAlesp=c('idAlesp'),cReg=c('regimeTramitacao'),cData=c('dataRegime');
  if(cReg<0||cData<0) throw new Error('Campos de regime não existem. Execute prepararBancoV67().');

  var localizados=0,atualizados=0;
  var valsReg=[],valsData=[];
  for(var i=1;i<data.length;i++){
    var regAtual=data[i][cReg]||'', dataAtual=data[i][cData]||'';
    if(String(data[i][cFonte]||'')==='ALESP'){
      var id=String((cIdAlesp>=0?data[i][cIdAlesp]:'')||(cId>=0?data[i][cId]:'')||'').trim();
      var achado=porId[id];
      if(achado){
        localizados++;
        if(String(regAtual)!==String(achado.nome)||String(dataAtual)!==String(achado.inicio||'')) atualizados++;
        regAtual=achado.nome;
        dataAtual=achado.inicio||'';
      }
    }
    valsReg.push([regAtual]); valsData.push([dataAtual]);
  }
  if(valsReg.length){
    sh.getRange(2,cReg+1,valsReg.length,1).setValues(valsReg);
    sh.getRange(2,cData+1,valsData.length,1).setValues(valsData);
  }

  var previstos=getRows_(getDb_(),'PROPOSITURAS').filter(function(p){return p.fonte==='ALESP'&&String(p.status||'')!=='Arquivar';}).length;
  var status={
    requestId:String(requestId||''),status:'CONCLUIDO',previstos:previstos,
    localizados:localizados,atualizados:atualizados,semRegime:Math.max(0,previstos-localizados),
    concluidoEm:fmtDateTime_(new Date()),meta:meta||{}
  };
  PropertiesService.getScriptProperties().setProperty('ALESP_REGIME_JOB_STATUS',JSON.stringify(status));
  return {ok:true,status:status};
}

function atualizarRegimesAlesp(token){
  validarSessao_(token);
  var sp=PropertiesService.getScriptProperties();
  var gh=sp.getProperty('GITHUB_TOKEN')||'';
  if(!gh) throw new Error('Integração GitHub não configurada: falta GITHUB_TOKEN nas propriedades do script.');
  var secret=sp.getProperty('INTEGRATION_SECRET')||'';
  if(!secret) throw new Error('Integração GitHub não configurada: falta INTEGRATION_SECRET nas propriedades do script.');

  var props=getRows_(getDb_(),'PROPOSITURAS').filter(function(p){return p.fonte==='ALESP'&&String(p.status||'')!=='Arquivar';});
  var ids=[];
  props.forEach(function(p){var id=String(p.idAlesp||p.idOficial||'').trim();if(id&&ids.indexOf(id)<0)ids.push(id);});
  if(!ids.length) throw new Error('Nenhum ID da ALESP encontrado na base.');

  var requestId=Utilities.getUuid();
  var status={requestId:requestId,status:'PROCESSANDO',previstos:props.length,iniciadoEm:fmtDateTime_(new Date())};
  sp.setProperty('ALESP_REGIME_JOB_STATUS',JSON.stringify(status));

  var url='https://api.github.com/repos/kauepierrii-art/monitor-legislativo/actions/workflows/alesp-regimes-on-demand.yml/dispatches';
  var resp=UrlFetchApp.fetch(url,{
    method:'post',muteHttpExceptions:true,contentType:'application/json',
    headers:{Authorization:'Bearer '+gh,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
    payload:JSON.stringify({ref:'main',inputs:{ids:ids.join(','),request_id:requestId}})
  });
  var rc=resp.getResponseCode();
  if(rc!==204){
    status.status='ERRO';status.erro='GitHub HTTP '+rc+': '+shortErr_(resp.getContentText());
    sp.setProperty('ALESP_REGIME_JOB_STATUS',JSON.stringify(status));
    throw new Error('Não foi possível iniciar o processamento no GitHub. HTTP '+rc);
  }
  return serializar_(status);
}

function getStatusAtualizacaoRegimesAlesp(token,requestId){
  validarSessao_(token);
  var raw=PropertiesService.getScriptProperties().getProperty('ALESP_REGIME_JOB_STATUS')||'{}';
  var s={};try{s=JSON.parse(raw);}catch(e){}
  if(requestId&&s.requestId&&String(requestId)!==String(s.requestId)) return {status:'PROCESSANDO',requestId:requestId};
  return serializar_(s);
}
'''

# Adiciona o bridge uma única vez logo após include().
if 'function aplicarRegimesAlespRecebidos_' not in code:
    marker="function include(f){ return HtmlService.createHtmlOutputFromFile(f).getContent(); }"
    if marker not in code:
        raise SystemExit('Marcador include() não encontrado em Code.gs')
    code=code.replace(marker, marker+'\n'+bridge, 1)
else:
    # Atualiza bloco existente de bridge caso já exista.
    start=code.index('function doPost(e){')
    end=code.index('\nfunction authVersion_()', start)
    code=code[:start]+bridge+'\n'+code[end+1:]

# Remove/substitui a função manual antiga para evitar nome duplicado.
# Se o bridge foi inserido antes da função antiga, mantém a primeira e remove a segunda.
occ=[m.start() for m in re.finditer(r'function atualizarRegimesAlesp\(token\)\{',code)]
if len(occ)>1:
    second=occ[1]
    nxt=code.find('\nfunction getProposituras',second)
    if nxt<0: raise SystemExit('Fim da função antiga atualizarRegimesAlesp não localizado')
    code=code[:second]+code[nxt+1:]

# Na verificação diária, não tenta mais processar regime pesado no Apps Script.
code=re.sub(
    r"\n\s*try\{\s*var rr=atualizarRegimesAlespInterno_\(props\);\s*result\.regimesAtualizados=Number\(rr\.atualizados\|\|0\);\s*\}catch\(regErr\)\{\s*result\.regimeAviso='Regime de tramitação não atualizado nesta tentativa: '\+shortErr_\(regErr\);\s*\}",
    "\n    result.regimeAviso='Regimes de tramitação da ALESP são atualizados sob demanda pelo GitHub Actions.';",
    code, count=1, flags=re.S
)

# ---- Frontend: botão dispara job e acompanha até concluir ----
new_ui=r'''async function atualizarRegimesAlespUI(btn){
 var original=btn?btn.textContent:'';
 try{
  if(btn){btn.disabled=true;btn.textContent='Iniciando atualização...';btn.classList.add('is-loading')}
  toast('Enviando regimes da ALESP para processamento...');
  var job=await api('atualizarRegimesAlesp',[token]);
  var requestId=job.requestId;
  var inicio=Date.now();
  while(Date.now()-inicio<180000){
    if(btn)btn.textContent='Processando regimes ALESP...';
    await new Promise(function(resolve){setTimeout(resolve,3500)});
    var s=await api('getStatusAtualizacaoRegimesAlesp',[token,requestId]);
    if(String(s.status)==='CONCLUIDO'){
      invalidate('proposituras');
      toast('Regimes ALESP: '+Number(s.localizados||0)+' de '+Number(s.previstos||0)+' localizados; '+Number(s.atualizados||0)+' atualizado(s).');
      await proposituras();
      return;
    }
    if(String(s.status)==='ERRO') throw new Error(s.erro||'Falha no processamento dos regimes ALESP.');
  }
  throw new Error('O processamento ainda não terminou. Tente atualizar a tela em alguns instantes.');
 }catch(e){toast(e.message)}
 finally{
  if(btn&&document.body.contains(btn)){btn.disabled=false;btn.textContent=original||'↻ Atualizar regimes ALESP';btn.classList.remove('is-loading')}
 }
}'''

start=index.find('async function atualizarRegimesAlespUI(btn){')
if start<0: raise SystemExit('Função atualizarRegimesAlespUI não encontrada em Index.html')
end=index.find('\nfunction separarMovimentoLegado',start)
if end<0: raise SystemExit('Fim de atualizarRegimesAlespUI não encontrado')
index=index[:start]+new_ui+index[end:]

code_path.write_text(code,encoding='utf-8')
index_path.write_text(index,encoding='utf-8')
print('Bridge GitHub ↔ Apps Script para regimes ALESP aplicado.')

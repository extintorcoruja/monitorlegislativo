
const CFG = {
  APP_NAME: 'Monitor Legislativo — Corpo de Bombeiros',
  PASSWORD: PropertiesService.getScriptProperties().getProperty('APP_PASSWORD') || '1234',
  SHEET_ID: PropertiesService.getScriptProperties().getProperty('SHEET_ID') || '',
  SESSION_TTL_SECONDS: 21600,

  CAMARA: 'https://dadosabertos.camara.leg.br/api/v2',
  SENADO: 'https://legis.senado.leg.br/dadosabertos',

  // ALESP: usamos o XML direto de 12 meses para evitar o unzip de arquivos muito grandes.
  ALESP_ANDAMENTOS_XML: 'https://www.al.sp.gov.br/repositorioDados/processo_legislativo/documento_andamento_atual.xml',
  ALESP_REGIME_ZIP:'https://www.al.sp.gov.br/repositorioDados/processo_legislativo/documento_regime.zip',
  ALESP_PALAVRAS_XML: 'https://www.al.sp.gov.br/repositorioDados/processo_legislativo/palavras_chave.xml',
  ALESP_DOCUMENTO_PALAVRAS_ZIP: 'https://www.al.sp.gov.br/repositorioDados/processo_legislativo/documento_palavras.zip',

  NOVAS_DIAS: 7,
  CAMARA_BATCH: 8,
  SENADO_BATCH: 5
};

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(CFG.APP_NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include(f){ return HtmlService.createHtmlOutputFromFile(f).getContent(); }

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

  var repo=String(sp.getProperty('GITHUB_REPO')||'extintorcoruja/monitorlegislativo').trim();
  var url='https://api.github.com/repos/'+repo+'/actions/workflows/alesp-regimes-on-demand.yml/dispatches';
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


function authVersion_(){
  return PropertiesService.getScriptProperties().getProperty('AUTH_VERSION') || '1';
}

function login(password) {
  var senhaAtual = PropertiesService.getScriptProperties().getProperty('APP_PASSWORD') || '1234';
  var ok = String(password || '') === String(senhaAtual);
  if (!ok) return {ok:false,message:'Senha incorreta.'};
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('session:' + token, authVersion_(), CFG.SESSION_TTL_SECONDS);
  return {ok:true,token:token};
}

function validarSessao_(token) {
  var cached = token ? CacheService.getScriptCache().get('session:' + token) : null;
  if (!cached || String(cached) !== String(authVersion_())) {
    throw new Error('Sessão expirada. Entre novamente.');
  }
}

function alterarSenhaAcesso(token,senhaAtual,novaSenha,confirmacao){
  validarSessao_(token);
  var props=PropertiesService.getScriptProperties();
  var atual=props.getProperty('APP_PASSWORD') || '1234';
  senhaAtual=String(senhaAtual||'');
  novaSenha=String(novaSenha||'');
  confirmacao=String(confirmacao||'');

  if(senhaAtual!==String(atual)) throw new Error('A senha atual está incorreta.');
  if(novaSenha.length<6) throw new Error('A nova senha deve ter pelo menos 6 caracteres.');
  if(novaSenha!==confirmacao) throw new Error('A confirmação da nova senha não confere.');
  if(novaSenha===senhaAtual) throw new Error('A nova senha deve ser diferente da senha atual.');

  props.setProperty('APP_PASSWORD',novaSenha);
  props.setProperty('AUTH_VERSION',String(Number(authVersion_())+1));
  return {ok:true,message:'Senha alterada. Entre novamente com a nova senha.'};
}

function getConfiguracoes(token){
  validarSessao_(token);
  return {ok:true,senhaConfigurada:!!PropertiesService.getScriptProperties().getProperty('APP_PASSWORD')};
}

/* ============================================================
   PREPARAÇÃO DO BANCO
   ============================================================ */
function prepararBancoV67() {
  var ss = getDb_();
  ensureSheet_(ss,'PROPOSITURAS',[
    'id','fonte','origem','idOficial','idCamara','idSenado','idAlesp',
    'tipo','numero','ano','autor','ementa','andamento','dataAndamento',
    'estadoOficial','dataEstadoOficial',
    'situacaoAtual','regimeTramitacao','dataRegime','tramitacaoAtual','dataUltimaTramitacao','orgaoAtual','detalheTramitacao',
    'link','tema','status','ultimaConsulta','erroUltimaConsulta'
  ]);
  ensureSheet_(ss,'PALAVRAS_CHAVE',['id','termo','peso','ativa']);
  ensureSheet_(ss,'VERIFICACOES',[
    'id','data','responsavel','inicio','fimTecnico','emissao','status',
    'totalPrevisto','totalVerificado','alteracoes','candidatas',
    'palavrasAtivas','buscasExecutadas','fontes','detalhes'
  ]);
  ensureSheet_(ss,'ALTERACOES',[
    'id','verificacaoId','proposituraId','fonte','propositura','campo',
    'anterior','novo','status','data','observacaoAnalise','analisadoEm'
  ]);
  ensureSheet_(ss,'CANDIDATAS',[
    'id','verificacaoId','fonte','origem','idOficial','tipo','numero','ano',
    'ementa','status','link','data','responsavel','observacao','decisaoEm',
    'ultimaEdicao','validacao','problemas'
  ]);
  ensureSheet_(ss,'RELATORIOS',[
    'id','verificacaoId','data','responsavel','inicio','fimTecnico','emissao',
    'status','observacao','totalPrevisto','totalVerificado','alteracoes',
    'candidatas','palavrasAtivas','buscasExecutadas','fontes','snapshot'
  ]);
  ensureSheet_(ss,'BUSCAS_MANUAIS',[
    'id','verificacaoId','fonte','responsavel','data','hora','status',
    'palavras','resultadosEncontrados','observacao'
  ]);

  var kw = ss.getSheetByName('PALAVRAS_CHAVE');
  if (kw.getLastRow() <= 1) {
    [
      ['Corpo de Bombeiros',10],['bombeiro militar',10],['bombeiros militares',10],
      ['segurança contra incêndio',8],['prevenção e combate a incêndio',8],
      ['AVCB',9],['militares estaduais',7],['defesa civil',5],
      ['salvamento',5],['resgate',4],['taxa de incêndio',8],['bombeiro civil',4]
    ].forEach(function(x){
      appendObject_('PALAVRAS_CHAVE',{
        id:Utilities.getUuid(),termo:x[0],peso:x[1],ativa:'Sim'
      });
    });
  }
  migrarBaseFederalV42_();
  limparCandidatasLegadasV5_();
  limparAlteracoesLegadasV65_();
  return 'Banco V6.7 preparado. Campos de regime de tramitação disponíveis.';
}

function prepararBancoV65(){ return prepararBancoV67(); }
function prepararBancoV64(){ return prepararBancoV67(); }
function prepararBancoV6(){ return prepararBancoV67(); }
function prepararBancoV5(){ return prepararBancoV67(); }
function prepararBancoV42(){ return prepararBancoV67(); }
function prepararBancoV3(){ return prepararBancoV67(); }

function migrarBaseFederalV42_(){
  var sh=getDb_().getSheetByName('PROPOSITURAS');
  if(!sh || sh.getLastRow()<2) return;
  var range=sh.getDataRange(), data=range.getValues(), h=data[0].map(String);
  function c(n){return h.indexOf(n);}
  var ix={
    fonte:c('fonte'),origem:c('origem'),id:c('idOficial'),idCam:c('idCamara'),
    idSen:c('idSenado'),idAle:c('idAlesp'),tipo:c('tipo'),num:c('numero'),
    ano:c('ano'),link:c('link')
  };
  for(var r=1;r<data.length;r++){
    var fonte=String(data[r][ix.fonte]||'');
    if(ix.origem>=0 && !data[r][ix.origem]) data[r][ix.origem]=fonte;
    var id=String(data[r][ix.id]||'');
    if(fonte==='Câmara' && id && ix.idCam>=0 && !data[r][ix.idCam]) data[r][ix.idCam]=id;
    if(fonte==='Senado' && id && ix.idSen>=0 && !data[r][ix.idSen]) data[r][ix.idSen]=id;
    if(fonte==='ALESP' && id && ix.idAle>=0 && !data[r][ix.idAle]) data[r][ix.idAle]=id;

    var tipo=String(data[r][ix.tipo]||'').toUpperCase();
    var num=String(data[r][ix.num]||'').replace(/\D/g,'');
    var ano=String(data[r][ix.ano]||'').replace(/\D/g,'');

    if(tipo==='PL' && num==='1354' && ano==='2023'){
      data[r][ix.fonte]='Câmara';
      if(ix.origem>=0)data[r][ix.origem]='Senado';
      data[r][ix.id]='2447989';
      if(ix.idCam>=0)data[r][ix.idCam]='2447989';
      if(ix.idSen>=0)data[r][ix.idSen]='156440';
      data[r][ix.link]='https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=2447989';
    }

    if(tipo==='PL' && num==='2684' && ano==='2025'){
      data[r][ix.fonte]='Câmara';
      if(ix.origem>=0)data[r][ix.origem]='Câmara';
      data[r][ix.id]='2519983';
      if(ix.idCam>=0)data[r][ix.idCam]='2519983';
      data[r][ix.link]='https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=2519983';
    }
  }
  range.setValues(data);
}


function limparCandidatasLegadasV5_(){
  var props=PropertiesService.getScriptProperties();
  if(props.getProperty('V5_CANDIDATAS_LIMPAS')==='SIM') return;
  var sh=getDb_().getSheetByName('CANDIDATAS');
  if(sh && sh.getLastRow()>1) sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).clearContent();
  props.setProperty('V5_CANDIDATAS_LIMPAS','SIM');
}


function limparAlteracoesLegadasV65_(){
  var sh=getDb_().getSheetByName('ALTERACOES');
  if(!sh || sh.getLastRow()<=1) return;
  var range=sh.getDataRange(),data=range.getValues(),headers=data[0];
  var idxCampo=headers.indexOf('campo');
  if(idxCampo<0) return;

  var keep=[headers];
  for(var i=1;i<data.length;i++){
    var campo=String(data[i][idxCampo]||'');
    // Remove apenas registros do modelo antigo combinado.
    if(campo==='estadoOficial' || campo==='andamento') continue;
    keep.push(data[i]);
  }

  if(keep.length===data.length) return;
  sh.clearContents();
  sh.getRange(1,1,keep.length,keep[0].length).setValues(keep);
}

/* ============================================================
   DASHBOARD / LISTAGENS
   ============================================================ */
function getDashboard(token) {
  validarSessao_(token);
  var props = getRows_(getDb_(),'PROPOSITURAS').filter(function(x){return String(x.status||'')!=='Arquivar';});
  var ver = getRows_(getDb_(),'VERIFICACOES');
  var rel = getRows_(getDb_(),'RELATORIOS');
  var hoje = fmtDate_(new Date());
  var today = null, active = null;

  rel.forEach(function(r){
    if (sameDayValue_(r.data, hoje) || sameDayValue_(r.emissao, hoje)) {
      today = {
        id:r.verificacaoId||r.id,data:r.data,responsavel:r.responsavel,
        fimTecnico:r.fimTecnico,emissao:r.emissao,status:'RELATÓRIO SALVO'
      };
    }
  });
  ver.forEach(function(v){
    if(sameDayValue_(v.data,hoje) && !String(v.emissao||'').trim()) active=v;
  });

  var fontes = {};
  props.forEach(function(p){ fontes[p.fonte] = (fontes[p.fonte]||0)+1; });

  return serializar_({
    total:props.length,fontes:fontes,hoje:today,emAndamento:active,
    palavras:getPalavrasAtivas_().map(function(w){return w.termo;})
  });
}

function getProposituras(token) {
  validarSessao_(token);
  return serializar_(getRows_(getDb_(),'PROPOSITURAS'));
}
function getAlteracoes(token) {
  validarSessao_(token);
  var props=getRows_(getDb_(),'PROPOSITURAS');
  var byId={};
  props.forEach(function(p){byId[String(p.id)]=p;});

  var rows=getRows_(getDb_(),'ALTERACOES').slice().reverse();
  rows.forEach(function(a){
    var p=byId[String(a.proposituraId||'')];

    // Fallback para históricos cujo UUID interno mudou.
    if(!p){
      var lab=String(a.propositura||'');
      var m=lab.match(/^([A-Za-zÀ-ÿ]+)\s+(\d+)\/(\d{4})/);
      if(m){
        p=props.find(function(q){
          return String(q.fonte)===String(a.fonte) &&
            String(q.tipo).toUpperCase()===String(m[1]).toUpperCase() &&
            String(q.numero)===String(m[2]) &&
            String(q.ano)===String(m[3]);
        });
      }
    }

    a.link=p&&p.link?p.link:'';
    a.idOficial=p&&p.idOficial?p.idOficial:'';

    if(a.campo==='situacaoAtual'){
      a.campoLabel='Situação';
    }else if(a.campo==='tramitacaoAtual'){
      a.campoLabel=a.fonte==='ALESP'?'Andamento':
        a.fonte==='Senado'?'Movimentação':'Tramitação';
    }else{
      a.campoLabel='Alteração';
    }

    if(!a.status) a.status='Pendente';
  });

  return serializar_(rows);
}
function getCandidatasPendentes(token) {
  validarSessao_(token);
  return serializar_(getRows_(getDb_(),'CANDIDATAS').filter(function(x){
    return String(x.status||'Pendente')==='Pendente';
  }).slice().reverse());
}
function setAlteracaoStatus(token,id,status) {
  validarSessao_(token);
  status=String(status||'');
  if(['Pendente','Confirmada','Ignorada'].indexOf(status)<0) throw new Error('Status inválido.');

  updateById_('ALTERACOES',id,{
    status:status,
    analisadoEm:status==='Pendente'?'':fmtDateTime_(new Date())
  });
  return getAlteracoes(token);
}
function reverterAlteracao(token,id){
  validarSessao_(token);
  updateById_('ALTERACOES',id,{status:'Pendente',analisadoEm:''});
  return getAlteracoes(token);
}

function registrarCandidataManual(token, verificationId, responsavel, dados){
  validarSessao_(token);
  var d=normalizarDadosCandidata_(dados||{});
  var problemas=validarDadosCandidata_(d,false);

  // Para entrar em avaliação exigimos identificação mínima + link.
  if(!d.fonte||!d.tipo||!d.numero||!d.ano){
    throw new Error('Para registrar para avaliação, informe casa, tipo, número e ano.');
  }
  if(!d.link){
    throw new Error('Informe o link oficial da propositura. Ele será usado para conferir e identificar a matéria antes da aprovação.');
  }

  var dup=localizarDuplicata_(d,null);
  if(dup.monitorada) throw new Error('Essa propositura já consta na base monitorada.');
  if(dup.candidata) throw new Error('Essa propositura já está aguardando avaliação.');

  appendObject_('CANDIDATAS',{
    id:Utilities.getUuid(),verificacaoId:verificationId||'',fonte:d.fonte,origem:d.origem||d.fonte,
    idOficial:d.idOficial,tipo:d.tipo,numero:d.numero,ano:d.ano,ementa:d.ementa,
    status:'Pendente',link:d.link,data:fmtDateTime_(new Date()),
    responsavel:String(responsavel||'').trim(),observacao:d.observacao,decisaoEm:'',
    ultimaEdicao:'',validacao:problemas.length?'Revisar':'Pronta para avaliação',
    problemas:problemas.join(' | ')
  });
  return {ok:true,problemas:problemas};
}

function atualizarCandidata(token,id,dados){
  validarSessao_(token);
  var atual=getRows_(getDb_(),'CANDIDATAS').find(function(x){return String(x.id)===String(id);});
  if(!atual) throw new Error('Propositura para avaliação não encontrada.');
  if(String(atual.status)!=='Pendente') throw new Error('Só é possível editar proposituras pendentes.');

  var d=normalizarDadosCandidata_(dados||{});
  var problemas=validarDadosCandidata_(d,false);
  if(!d.fonte||!d.tipo||!d.numero||!d.ano||!d.link){
    throw new Error('Casa, tipo, número, ano e link oficial são obrigatórios.');
  }

  var dup=localizarDuplicata_(d,id);
  if(dup.monitorada) throw new Error('Essa propositura já consta na base monitorada.');
  if(dup.candidata) throw new Error('Já existe outra propositura igual aguardando avaliação.');

  updateById_('CANDIDATAS',id,{
    fonte:d.fonte,origem:d.origem||d.fonte,idOficial:d.idOficial,
    tipo:d.tipo,numero:d.numero,ano:d.ano,ementa:d.ementa,link:d.link,
    observacao:d.observacao,ultimaEdicao:fmtDateTime_(new Date()),
    validacao:problemas.length?'Revisar':'Pronta para avaliação',
    problemas:problemas.join(' | ')
  });
  return {ok:true,problemas:problemas};
}

function validarCandidataParaAprovacao(token,id){
  validarSessao_(token);
  var c=getRows_(getDb_(),'CANDIDATAS').find(function(x){return String(x.id)===String(id);});
  if(!c) throw new Error('Propositura para avaliação não encontrada.');
  var d=normalizarDadosCandidata_(c);
  var problemas=validarDadosCandidata_(d,true);
  var idOficial=d.idOficial;

  if(!idOficial && d.fonte==='Senado'){
    try{idOficial=resolverIdSenado_(d)||'';}catch(e){}
  }
  if(!idOficial) problemas.push('ID oficial não identificado. Confira o link e os dados da matéria.');

  var dup=localizarDuplicata_(Object.assign({},d,{idOficial:idOficial}),id);
  if(dup.monitorada) problemas.push('A matéria já existe na base monitorada.');

  updateById_('CANDIDATAS',id,{
    idOficial:idOficial,
    validacao:problemas.length?'Revisar':'Validada',
    problemas:problemas.join(' | ')
  });
  return serializar_({ok:problemas.length===0,idOficial:idOficial,problemas:problemas});
}

function aprovarCandidata(token,id){
  validarSessao_(token);
  var c=getRows_(getDb_(),'CANDIDATAS').find(function(x){return String(x.id)===String(id);});
  if(!c) throw new Error('Propositura para avaliação não encontrada.');
  if(String(c.status)!=='Pendente') throw new Error('Essa propositura já foi avaliada.');

  var valid=validarCandidataInterna_(c,id);
  if(!valid.ok){
    throw new Error('Antes de adicionar ao monitoramento, corrija: '+valid.problemas.join(' | '));
  }

  var idOficial=valid.idOficial;
  var obj={
    id:Utilities.getUuid(),fonte:c.fonte,origem:c.origem||c.fonte,idOficial:idOficial,
    idCamara:c.fonte==='Câmara'?idOficial:'',idSenado:c.fonte==='Senado'?idOficial:'',idAlesp:c.fonte==='ALESP'?idOficial:'',
    tipo:String(c.tipo||'').toUpperCase(),numero:String(c.numero||''),ano:String(c.ano||''),
    autor:'',ementa:c.ementa||'',andamento:'',dataAndamento:'',
    estadoOficial:'',dataEstadoOficial:'',link:c.link||'',tema:'',
    status:'Monitorar',ultimaConsulta:'',erroUltimaConsulta:''
  };
  appendObject_('PROPOSITURAS',obj);
  updateById_('CANDIDATAS',id,{
    status:'Adicionada',idOficial:idOficial,validacao:'Validada',
    problemas:'',decisaoEm:fmtDateTime_(new Date())
  });
  return {ok:true};
}

function ignorarCandidata(token,id){
  validarSessao_(token);
  updateById_('CANDIDATAS',id,{status:'Ignorada',decisaoEm:fmtDateTime_(new Date())});
  return {ok:true};
}

function normalizarDadosCandidata_(dados){
  var fonte=String(dados.fonte||'').trim();
  var tipo=String(dados.tipo||'').trim().toUpperCase().replace(/\s+/g,' ');
  var numero=String(dados.numero||'').trim().replace(/[^\d]/g,'');
  var ano=String(dados.ano||'').trim().replace(/[^\d]/g,'');
  var link=String(dados.link||'').trim();
  var id=String(dados.idOficial||'').trim().replace(/[^\d]/g,'');
  if(!id && link) id=extrairIdDoLink_(fonte,link)||'';
  return {
    fonte:fonte,origem:String(dados.origem||fonte).trim(),idOficial:id,
    tipo:tipo,numero:numero,ano:ano,ementa:String(dados.ementa||'').trim(),
    link:link,observacao:String(dados.observacao||'').trim()
  };
}

function validarDadosCandidata_(d,paraAprovacao){
  var p=[];
  if(['Câmara','Senado','ALESP'].indexOf(d.fonte)<0) p.push('Casa legislativa inválida.');
  if(!d.tipo) p.push('Tipo não informado.');
  if(!d.numero || !/^\d+$/.test(d.numero)) p.push('Número deve conter apenas algarismos.');
  var ano=Number(d.ano||0), atual=new Date().getFullYear();
  if(!/^\d{4}$/.test(d.ano) || ano<1900 || ano>atual+1) p.push('Ano inválido.');
  if(!d.link) p.push('Link oficial não informado.');
  if(d.link && !linkCompativelComFonte_(d.fonte,d.link)) p.push('O link não parece pertencer à casa legislativa selecionada.');
  if(paraAprovacao && !d.ementa) p.push('Ementa/resumo não informado. Confira a matéria antes de aprovar.');
  return p;
}

function linkCompativelComFonte_(fonte,link){
  var s=String(link||'').toLowerCase();
  if(fonte==='Câmara') return s.indexOf('camara.leg.br')>=0;
  if(fonte==='Senado') return s.indexOf('senado.leg.br')>=0;
  if(fonte==='ALESP') return s.indexOf('al.sp.gov.br')>=0;
  return false;
}

function localizarDuplicata_(d,ignorarCandidataId){
  var monitorada=getRows_(getDb_(),'PROPOSITURAS').some(function(p){
    return (d.idOficial && p.fonte===d.fonte && String(p.idOficial)===String(d.idOficial)) ||
      (p.fonte===d.fonte && String(p.tipo).toUpperCase()===d.tipo && String(p.numero)===d.numero && String(p.ano)===d.ano);
  });
  var candidata=getRows_(getDb_(),'CANDIDATAS').some(function(c){
    if(String(c.id)===String(ignorarCandidataId||'')) return false;
    if(String(c.status||'Pendente')!=='Pendente') return false;
    return (d.idOficial && c.fonte===d.fonte && String(c.idOficial)===String(d.idOficial)) ||
      (c.fonte===d.fonte && String(c.tipo).toUpperCase()===d.tipo && String(c.numero)===d.numero && String(c.ano)===d.ano);
  });
  return {monitorada:monitorada,candidata:candidata};
}

function validarCandidataInterna_(c,id){
  var d=normalizarDadosCandidata_(c),problemas=validarDadosCandidata_(d,true),idOficial=d.idOficial;
  if(!idOficial && d.fonte==='Senado'){
    try{idOficial=resolverIdSenado_(d)||'';}catch(e){}
  }
  if(!idOficial) problemas.push('ID oficial não identificado.');
  var dup=localizarDuplicata_(Object.assign({},d,{idOficial:idOficial}),id);
  if(dup.monitorada) problemas.push('A matéria já existe na base monitorada.');
  updateById_('CANDIDATAS',id,{
    idOficial:idOficial,validacao:problemas.length?'Revisar':'Validada',
    problemas:problemas.join(' | ')
  });
  return {ok:problemas.length===0,idOficial:idOficial,problemas:problemas};
}

function extrairIdDoLink_(fonte,link){
  var s=String(link||'');
  var m=null;
  if(fonte==='Câmara') m=s.match(/[?&]idProposicao=(\d+)/i);
  else if(fonte==='Senado') m=s.match(/\/materia\/(\d+)(?:[/?#]|$)/i);
  else if(fonte==='ALESP') m=s.match(/[?&]id=(\d+)/i);
  return m?m[1]:'';
}

/* ============================================================
   SESSÃO
   ============================================================ */
function iniciarVerificacao(token,responsavel) {
  validarSessao_(token);
  responsavel = String(responsavel||'').trim();
  if (!responsavel) throw new Error('Informe o responsável pela consulta.');
  var id=Utilities.getUuid(), now=new Date();
  appendObject_('VERIFICACOES',{
    id:id,data:fmtDate_(now),responsavel:responsavel,inicio:fmtDateTime_(now),
    fimTecnico:'',emissao:'',status:'EM ANDAMENTO',
    totalPrevisto:0,totalVerificado:0,alteracoes:0,candidatas:0,
    palavrasAtivas:0,buscasExecutadas:0,fontes:'',detalhes:''
  });
  return {ok:true,verificationId:id,startedAt:fmtDateTime_(now)};
}


function getVerificacaoAtual(token,verificationId){
  validarSessao_(token);
  var v=getRows_(getDb_(),'VERIFICACOES').find(function(x){return String(x.id)===String(verificationId);});
  if(!v) throw new Error('Verificação não encontrada.');
  var d={};try{d=JSON.parse(String(v.detalhes||'{}'));}catch(e){}
  return serializar_({id:v.id,responsavel:v.responsavel,status:v.status,detalhes:d});
}

function concluirVerificacaoTecnica(token,verificationId,resumo) {
  validarSessao_(token);
  var now=new Date();
  updateById_('VERIFICACOES',verificationId,{
    fimTecnico:fmtDateTime_(now),
    status:resumo.completa?'CONCLUÍDA':'PARCIAL',
    totalPrevisto:resumo.totalPrevisto,
    totalVerificado:resumo.totalVerificado,
    alteracoes:resumo.alteracoes,
    candidatas:resumo.candidatas,
    palavrasAtivas:resumo.palavras,
    buscasExecutadas:resumo.buscas,
    fontes:resumo.fontes,
    detalhes:JSON.stringify(resumo)
  });
  return {ok:true,finishedAt:fmtDateTime_(now)};
}

/* ============================================================
   CÂMARA — MONITORAMENTO
   Estratégia:
   - endpoint /proposicoes/{id} traz o status atual em uma única resposta
   - pequenos lotes para não provocar rate-limit
   - falhas recebem retry individual
   ============================================================ */
function verificarCamara(token,verificationId) {
  validarSessao_(token);
  var props = getRows_(getDb_(),'PROPOSITURAS').filter(function(p){
    return p.fonte==='Câmara' && String(p.status||'')!=='Arquivar';
  });

  var valid = props.filter(function(p){return String(p.idOficial||'').trim()!=='';});
  var result = {fonte:'Câmara',previsto:props.length,verificado:0,alteracoes:0,erros:0,baselines:0,detalhes:[]};

  for (var start=0; start<valid.length; start+=CFG.CAMARA_BATCH) {
    var lote=valid.slice(start,start+CFG.CAMARA_BATCH);
    var reqs=lote.map(function(p){
      return {
        url:CFG.CAMARA+'/proposicoes/'+encodeURIComponent(p.idOficial),
        method:'get',muteHttpExceptions:true,headers:{Accept:'application/json'}
      };
    });
    var resps=null;
    try{resps=UrlFetchApp.fetchAll(reqs);}catch(batchErr){resps=null;}

    for (var i=0;i<lote.length;i++) {
      var p=lote[i], resp=resps?resps[i]:null;
      try {
        if(!resp) throw new Error('consulta em lote indisponível');
        var parsed=parseCamaraDetalhe_(resp);
        aplicarResultadoCamara_(verificationId,p,parsed,result);
      } catch(e) {
        // retry individual para que um único endereço problemático não derrube o lote todo
        try {
          Utilities.sleep(250);
          var retry=UrlFetchApp.fetch(CFG.CAMARA+'/proposicoes/'+encodeURIComponent(p.idOficial),{
            muteHttpExceptions:true,headers:{Accept:'application/json'}
          });
          var parsed2=parseCamaraDetalhe_(retry);
          aplicarResultadoCamara_(verificationId,p,parsed2,result);
        } catch(e2) {
          result.erros++;
          var detalheErro=labelProp_(p)+' — ID '+String(p.idOficial||'')+': '+shortErr_(e2);
          result.detalhes.push(detalheErro);
          updateProp_(p.id,{ultimaConsulta:fmtDateTime_(new Date()),erroUltimaConsulta:shortErr_(e2)});
        }
      }
    }
    Utilities.sleep(180);
  }

  var semId=props.length-valid.length;
  if (semId) {
    result.erros+=semId;
    result.detalhes.push(semId+' item(ns) da Câmara sem ID oficial.');
  }
  return serializar_(result);
}
function parseCamaraDetalhe_(resp) {
  var code=resp.getResponseCode();
  if(code<200||code>=300) throw new Error('HTTP '+code);
  var obj=JSON.parse(resp.getContentText('UTF-8'));
  var d=obj.dados;
  if(!d) throw new Error('Resposta sem "dados"');
  var s=d.statusProposicao||{};

  var situacao=normalizar_(s.descricaoSituacao||'');
  var tramitacao=normalizar_(s.descricaoTramitacao||'');
  var detalhe=normalizar_(s.despacho||'');
  var orgao=normalizar_(s.siglaOrgao||'');
  var data=String(s.dataHora||'');

  if(!situacao && !tramitacao && !detalhe) throw new Error('Situação/tramitação atual não identificada');

  return {
    situacao:situacao,
    tramitacao:tramitacao,
    data:data,
    orgao:orgao,
    detalhe:detalhe,
    ementa:d.ementa||''
  };
}
function aplicarResultadoCamara_(verificationId,p,x,result) {
  aplicarCamposLegislativos_(verificationId,p,x,result);
  var patch={ultimaConsulta:fmtDateTime_(new Date()),erroUltimaConsulta:''};
  if(x.ementa) patch.ementa=x.ementa;
  updateProp_(p.id,patch);
  result.verificado++;
}

/* ============================================================
   SENADO — MONITORAMENTO V4.2
   - API oficial como fonte principal
   - parser tolerante a estruturas diferentes
   - fallback para a página oficial da própria matéria
   ============================================================ */
function verificarSenado(token,verificationId) {
  validarSessao_(token);
  var props=getRows_(getDb_(),'PROPOSITURAS').filter(function(p){
    return p.fonte==='Senado' && String(p.status||'')!=='Arquivar';
  });
  var result={fonte:'Senado',previsto:props.length,verificado:0,alteracoes:0,erros:0,baselines:0,detalhes:[]};

  var valid=props.filter(function(p){return String(p.idOficial||'').trim()!=='';});
  var semId=props.length-valid.length;
  if(semId){
    result.erros+=semId;
    props.filter(function(p){return !String(p.idOficial||'').trim();}).forEach(function(p){
      result.detalhes.push(labelProp_(p)+': sem ID oficial do Senado.');
    });
  }

  for(var start=0;start<valid.length;start+=CFG.SENADO_BATCH){
    var lote=valid.slice(start,start+CFG.SENADO_BATCH);
    var reqs=[];
    lote.forEach(function(p){
      reqs.push({
        url:CFG.SENADO+'/materia/situacaoatual/'+encodeURIComponent(p.idOficial),
        method:'get',muteHttpExceptions:true,headers:{Accept:'application/json'}
      });
      reqs.push({
        url:CFG.SENADO+'/materia/movimentacoes/'+encodeURIComponent(p.idOficial),
        method:'get',muteHttpExceptions:true,headers:{Accept:'application/json'}
      });
    });

    var rs=UrlFetchApp.fetchAll(reqs);

    for(var i=0;i<lote.length;i++){
      var p=lote[i],sit=null,mov=null,errs=[];
      try{sit=parseSenadoSituacaoSeparada_(rs[i*2]);}catch(e){errs.push('situação: '+shortErr_(e));}
      try{mov=parseSenadoMovimentacaoSeparada_(rs[i*2+1]);}catch(e2){errs.push('tramitação: '+shortErr_(e2));}

      // Fallback no detalhe genérico apenas se ambos falharem.
      if(!sit && !mov){
        try{
          var fb=UrlFetchApp.fetch(CFG.SENADO+'/materia/'+encodeURIComponent(p.idOficial),{
            muteHttpExceptions:true,headers:{Accept:'application/json'}
          });
          var x=parseSenadoDetalheSeparadoFallback_(fb);
          sit=x.situacao?{situacao:x.situacao,orgao:x.orgao||''}:null;
          mov=x.tramitacao?{tramitacao:x.tramitacao,data:x.data||'',orgao:x.orgao||'',detalhe:x.detalhe||''}:null;
        }catch(e3){}
      }

      if(!sit && !mov){
        result.erros++;
        var msg=labelProp_(p)+': '+(errs.join(' | ')||'dados de situação/tramitação não identificados');
        result.detalhes.push(msg);
        updateProp_(p.id,{ultimaConsulta:fmtDateTime_(new Date()),erroUltimaConsulta:msg});
        continue;
      }

      try{
        var x2={
          situacao:sit&&sit.situacao?sit.situacao:'',
          tramitacao:mov&&mov.tramitacao?mov.tramitacao:'',
          data:mov&&mov.data?mov.data:'',
          orgao:(sit&&sit.orgao)||(mov&&mov.orgao)||'',
          detalhe:mov&&mov.detalhe?mov.detalhe:''
        };
        aplicarCamposLegislativos_(verificationId,p,x2,result);
        updateProp_(p.id,{ultimaConsulta:fmtDateTime_(new Date()),erroUltimaConsulta:''});
        result.verificado++;
      }catch(e4){
        result.erros++;
        result.detalhes.push(labelProp_(p)+': '+shortErr_(e4));
        updateProp_(p.id,{ultimaConsulta:fmtDateTime_(new Date()),erroUltimaConsulta:shortErr_(e4)});
      }
    }
    Utilities.sleep(120);
  }
  return serializar_(result);
}

function parseSenadoSituacaoSeparada_(resp){
  var code=resp.getResponseCode();
  if(code<200||code>=300) throw new Error('HTTP '+code);
  var obj=JSON.parse(resp.getContentText('UTF-8'));
  var candidatos=[];
  walk_(obj,function(x){
    if(!x||typeof x!=='object'||Array.isArray(x))return;
    var keys=Object.keys(x);
    function first(res){
      for(var i=0;i<res.length;i++){
        var k=keys.find(function(q){return res[i].test(q);});
        if(k && x[k]!==null && typeof x[k]!=='object' && String(x[k]).trim()) return String(x[k]);
      }
      return '';
    }
    var situacao=first([/^DescricaoSituacao$/i,/SituacaoDescricao/i,/NomeSituacao/i,/DescricaoEstado/i]);
    var orgao=first([/^SiglaLocal$/i,/^NomeLocal$/i,/^SiglaOrgao$/i,/^NomeOrgao$/i]);
    if(situacao) candidatos.push({situacao:normalizar_(situacao),orgao:normalizar_(orgao),score:(orgao?2:0)+5});
  });
  if(!candidatos.length) throw new Error('situação não reconhecida');
  candidatos.sort(function(a,b){return b.score-a.score;});
  return candidatos[0];
}

function parseSenadoMovimentacaoSeparada_(resp){
  var code=resp.getResponseCode();
  if(code<200||code>=300) throw new Error('HTTP '+code);
  var obj=JSON.parse(resp.getContentText('UTF-8'));
  var candidatos=[];
  walk_(obj,function(x){
    if(!x||typeof x!=='object'||Array.isArray(x))return;
    var keys=Object.keys(x);
    function first(res){
      for(var i=0;i<res.length;i++){
        var k=keys.find(function(q){return res[i].test(q);});
        if(k && x[k]!==null && typeof x[k]!=='object' && String(x[k]).trim()) return String(x[k]);
      }
      return '';
    }
    var data=first([/^DataMovimentacao$/i,/^DataTramitacao$/i,/^DataAcao$/i,/^Data$/i]);
    var tramitacao=first([/^DescricaoMovimentacao$/i,/^DescricaoTramitacao$/i,/^DescricaoAcao$/i,/^TextoAcao$/i,/^AcaoLegislativa$/i]);
    var detalhe=first([/^Descricao$/i,/^TextoDespacho$/i,/^Despacho$/i,/^Complemento$/i]);
    var orgao=first([/^SiglaLocal$/i,/^NomeLocal$/i,/^SiglaOrgao$/i,/^NomeOrgao$/i]);
    if(tramitacao || detalhe){
      candidatos.push({
        data:data,
        tramitacao:normalizar_(tramitacao||detalhe),
        detalhe:normalizar_(tramitacao&&detalhe&&normalizar_(tramitacao)!==normalizar_(detalhe)?detalhe:''),
        orgao:normalizar_(orgao),
        score:(data?4:0)+(tramitacao?5:0)+(orgao?1:0)
      });
    }
  });
  if(!candidatos.length) throw new Error('movimentação não reconhecida');
  candidatos.sort(function(a,b){
    var dt=toTime_(b.data)-toTime_(a.data);
    return dt!==0?dt:(b.score-a.score);
  });
  return candidatos[0];
}

function parseSenadoDetalheSeparadoFallback_(resp){
  var code=resp.getResponseCode();
  if(code<200||code>=300) throw new Error('HTTP '+code);
  var obj=JSON.parse(resp.getContentText('UTF-8'));
  var sit='',tram='',data='',orgao='',detalhe='';
  walk_(obj,function(x){
    if(!x||typeof x!=='object'||Array.isArray(x))return;
    Object.keys(x).forEach(function(k){
      var v=x[k];
      if(v===null||typeof v==='object'||!String(v).trim())return;
      if(!sit && /DescricaoSituacao|SituacaoDescricao/i.test(k)) sit=String(v);
      if(!tram && /DescricaoMovimentacao|DescricaoTramitacao|DescricaoAcao|TextoAcao/i.test(k)) tram=String(v);
      if(!data && /DataMovimentacao|DataTramitacao|DataAcao/i.test(k)) data=String(v);
      if(!orgao && /SiglaLocal|NomeLocal|SiglaOrgao|NomeOrgao/i.test(k)) orgao=String(v);
      if(!detalhe && /Despacho|Complemento/i.test(k)) detalhe=String(v);
    });
  });
  if(!sit&&!tram) throw new Error('detalhe sem situação/tramitação reconhecível');
  return {situacao:normalizar_(sit),tramitacao:normalizar_(tram),data:data,orgao:normalizar_(orgao),detalhe:normalizar_(detalhe)};
}

/* ============================================================
   ALESP — MONITORAMENTO
   Estratégia:
   - XML direto dos últimos 12 meses
   - um único download
   - ausência no XML significa "nenhum andamento nos últimos 12 meses";
     ainda assim a matéria foi conferida contra o dataset diário.
   ============================================================ */
function fetchAlespComRetry_(){
  var ultimoErro=null;
  for(var tentativa=1;tentativa<=3;tentativa++){
    try{
      var r=UrlFetchApp.fetch(CFG.ALESP_ANDAMENTOS_XML,{
        muteHttpExceptions:true,
        headers:{Accept:'application/xml,text/xml,*/*'}
      });
      var c=r.getResponseCode();
      if(c>=200&&c<300) return r;
      if([502,503,504].indexOf(c)<0) return r;
      ultimoErro=new Error('HTTP '+c);
    }catch(e){
      ultimoErro=e;
    }
    if(tentativa<3) Utilities.sleep(800*tentativa);
  }
  throw ultimoErro||new Error('Fonte ALESP indisponível');
}

function atualizarRegimesAlespInterno_(props){
  props=props||[];
  if(!props.length) return {ok:true,previstos:0,localizados:0,atualizados:0,semRegime:0,faltantes:[]};

  var ids={};
  props.forEach(function(p){
    var id=String(p.idAlesp||p.idOficial||'').trim();
    if(id) ids[id]=p;
  });

  var ckan='https://ckan.al.sp.gov.br/api/3/action/package_search?q='+encodeURIComponent('regime de tramitação');
  var metaResp=UrlFetchApp.fetch(ckan,{muteHttpExceptions:true,headers:{Accept:'application/json'}});
  if(metaResp.getResponseCode()<200||metaResp.getResponseCode()>=300){
    throw new Error('Não foi possível consultar o catálogo de Dados Abertos da ALESP. HTTP '+metaResp.getResponseCode());
  }
  var meta=JSON.parse(metaResp.getContentText('UTF-8'));
  var packs=(meta&&meta.result&&meta.result.results)||[];
  var pkg=packs.find(function(x){
    var nome=String(x.title||x.name||'');
    return /regime/i.test(nome)&&/tramita/i.test(nome);
  })||packs.find(function(x){return /regime/i.test(String(x.title||x.name||''));});
  if(!pkg) throw new Error('Recurso de regimes não localizado no catálogo da ALESP.');

  var resources=pkg.resources||[];
  var res=resources.find(function(r){
    var f=String(r.format||'').toUpperCase(),u=String(r.url||'');
    return f==='JSON'||/\.json(?:$|\?)/i.test(u);
  });
  if(!res||!res.url) throw new Error('A ALESP não informou um recurso JSON para regimes de tramitação.');

  var resp=UrlFetchApp.fetch(res.url,{muteHttpExceptions:true,headers:{Accept:'application/json'}});
  var status=resp.getResponseCode();
  if(status<200||status>=300) throw new Error('Regime ALESP JSON HTTP '+status);
  var payload=JSON.parse(resp.getContentText('UTF-8'));

  var encontrados={},registros=0,amostraChaves=[];
  function keyNorm_(k){
    return String(k||'').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-z0-9]/g,'');
  }
  function valorPor_(map,nomes){
    for(var i=0;i<nomes.length;i++) if(map[nomes[i]]!==undefined&&map[nomes[i]]!==null&&String(map[nomes[i]]).trim()!=='') return map[nomes[i]];
    return '';
  }
  function valorFuzzy_(map,pred){
    var ks=Object.keys(map);
    for(var i=0;i<ks.length;i++) if(pred(ks[i])) return map[ks[i]];
    return '';
  }
  function walk_(node){
    if(node===null||node===undefined)return;
    if(Array.isArray(node)){node.forEach(walk_);return;}
    if(typeof node!=='object')return;

    var map={};
    Object.keys(node).forEach(function(k){map[keyNorm_(k)]=node[k];});

    var id=valorPor_(map,['iddocumento','documentoid','idpropositura','proposituraid','iddoc']);
    if(!id) id=valorFuzzy_(map,function(k){return (k.indexOf('id')>=0&&k.indexOf('document')>=0)||(k.indexOf('id')>=0&&k.indexOf('proposit')>=0);});

    var nome=valorPor_(map,['nomeregime','regime','regimetramitacao','nomeregimetramitacao','descricaoregime','nmregime']);
    if(!nome) nome=valorFuzzy_(map,function(k){return k.indexOf('regime')>=0&&k.indexOf('id')<0&&k.indexOf('data')<0&&k.indexOf('inicio')<0&&k.indexOf('fim')<0;});

    if(id||nome){
      registros++;
      if(amostraChaves.length<3) amostraChaves.push(Object.keys(map).slice(0,12).join(','));
    }

    id=String(id||'').trim();
    nome=String(nome||'').trim();
    if(id&&nome&&ids[id]){
      var ini=valorPor_(map,['datainicio','dtinicio','inicioregime','datainicioregime']);
      if(!ini) ini=valorFuzzy_(map,function(k){return (k.indexOf('inicio')>=0||k.indexOf('ini')===0)&&k.indexOf('regime')>=0;});
      var fim=valorPor_(map,['datafim','dtfim','fimregime','datafimregime']);
      if(!fim) fim=valorFuzzy_(map,function(k){return k.indexOf('fim')>=0&&k.indexOf('regime')>=0;});
      ini=String(ini||'').trim();
      fim=String(fim||'').trim();
      var cand={nome:normalizar_(nome),inicio:ini,fim:fim,ativo:!fim};
      var atual=encontrados[id];
      if(!atual||(cand.ativo&&!atual.ativo)||(cand.ativo===atual.ativo&&toTime_(cand.inicio)>toTime_(atual.inicio))) encontrados[id]=cand;
    }

    Object.keys(node).forEach(function(k){var v=node[k];if(v&&typeof v==='object')walk_(v);});
  }
  walk_(payload);

  var sh=getDb_().getSheetByName('PROPOSITURAS');
  if(!sh||sh.getLastRow()<2) throw new Error('Aba PROPOSITURAS não encontrada.');
  var data=sh.getDataRange().getValues(),h=data[0].map(String);
  function c(n){return h.indexOf(n);}
  var cFonte=c('fonte'),cId=c('idOficial'),cIdAlesp=c('idAlesp'),cReg=c('regimeTramitacao'),cData=c('dataRegime');
  if(cReg<0||cData<0) throw new Error('Campos de regime não existem. Execute prepararBancoV67().');

  var valsReg=[],valsData=[],atualizados=0,localizados=0;
  for(var r=1;r<data.length;r++){
    var regAtual=data[r][cReg]||'',dataAtual=data[r][cData]||'';
    if(String(data[r][cFonte]||'')==='ALESP'){
      var idLinha=String((cIdAlesp>=0?data[r][cIdAlesp]:'')||(cId>=0?data[r][cId]:'')||'').trim();
      var achado=encontrados[idLinha];
      if(achado){
        localizados++;
        if(String(regAtual)!==String(achado.nome)||String(dataAtual)!==String(achado.inicio||''))atualizados++;
        regAtual=achado.nome;dataAtual=achado.inicio||'';
      }
    }
    valsReg.push([regAtual]);valsData.push([dataAtual]);
  }
  if(valsReg.length){
    sh.getRange(2,cReg+1,valsReg.length,1).setValues(valsReg);
    sh.getRange(2,cData+1,valsData.length,1).setValues(valsData);
  }

  var faltantes=[];
  props.forEach(function(p){
    var id=String(p.idAlesp||p.idOficial||'').trim();
    if(id&&!encontrados[id]&&faltantes.length<8)faltantes.push(labelProp_(p));
  });

  if(localizados===0){
    throw new Error('JSON da ALESP carregado, mas nenhum regime cruzou com a base. Registros candidatos lidos: '+registros+'. Chaves encontradas: '+(amostraChaves[0]||'nenhuma')+'.');
  }

  return {ok:true,previstos:props.length,localizados:localizados,atualizados:atualizados,semRegime:Math.max(0,props.length-localizados),faltantes:faltantes,fonte:'JSON'};
}
function verificarAlesp(token,verificationId) {
  validarSessao_(token);
  var props=getRows_(getDb_(),'PROPOSITURAS').filter(function(p){
    return p.fonte==='ALESP' && String(p.status||'')!=='Arquivar';
  });
  var result={fonte:'ALESP',previsto:props.length,verificado:0,alteracoes:0,erros:0,baselines:0,detalhes:[]};
  var byId={};
  props.forEach(function(p){if(p.idOficial)byId[String(p.idOficial)]=p;});

  try{
    var r=fetchAlespComRetry_();
    var code=r.getResponseCode();
    if(code<200||code>=300) throw new Error('HTTP '+code);
    var xml=r.getContentText('UTF-8');
    if(xml.indexOf('<DocumentoAndamento>')<0) throw new Error('XML de andamento não reconhecido');

    var latest={};
    var re=/<DocumentoAndamento>([\s\S]*?)<\/DocumentoAndamento>/g;
    var m;
    while((m=re.exec(xml))!==null){
      var block=m[1];
      var id=tag_(block,'IdDocumento');
      if(!id||!byId[id])continue;
      var data=tag_(block,'Data')||'';
      var ordem=Number(tag_(block,'NrOrdem')||0);
      var desc=tag_(block,'Descricao')||'';
      var etapa=tag_(block,'NmEtapa')||'';
      var com=tag_(block,'SiglaComissao')||'';
      var key=String(toTime_(data)).padStart(15,'0')+'|'+String(ordem).padStart(8,'0');
      var tramitacao=normalizar_(etapa||desc||'');
      var detalhe=normalizar_(desc||'');
      if(tramitacao && detalhe===tramitacao) detalhe='';
      if(!latest[id]||key>latest[id].key) latest[id]={
        key:key,tramitacao:tramitacao,data:data,orgao:normalizar_(com),detalhe:detalhe
      };
    }

    props.forEach(function(p){
      try{
        if(!p.idOficial) throw new Error('Sem ID oficial ALESP');
        var x=latest[String(p.idOficial)];
        if(x&&x.tramitacao){
          aplicarCamposLegislativos_(verificationId,p,{
            situacao:'',
            tramitacao:x.tramitacao,
            data:x.data||'',
            orgao:x.orgao||'',
            detalhe:x.detalhe||''
          },result);
        }
        updateProp_(p.id,{ultimaConsulta:fmtDateTime_(new Date()),erroUltimaConsulta:''});
        result.verificado++;
      }catch(e){
        result.erros++;
        result.detalhes.push(labelProp_(p)+': '+shortErr_(e));
        updateProp_(p.id,{ultimaConsulta:fmtDateTime_(new Date()),erroUltimaConsulta:shortErr_(e)});
      }
    });
    result.regimeAviso='Regimes de tramitação da ALESP são atualizados sob demanda pelo GitHub Actions.';
  }catch(e){
    result.erros=props.length;
    result.detalhes.push('Falha geral ALESP: '+shortErr_(e));
    props.forEach(function(p){
      updateProp_(p.id,{ultimaConsulta:fmtDateTime_(new Date()),erroUltimaConsulta:shortErr_(e)});
    });
  }
  return serializar_(result);
}



function reverificarFonte(token,verificationId,fonte){
  validarSessao_(token);
  var r;
  if(fonte==='Câmara') r=verificarCamara(token,verificationId);
  else if(fonte==='Senado') r=verificarSenado(token,verificationId);
  else if(fonte==='ALESP') r=verificarAlesp(token,verificationId);
  else throw new Error('Casa legislativa inválida.');

  var v=getRows_(getDb_(),'VERIFICACOES').find(function(x){return String(x.id)===String(verificationId);});
  if(!v) throw new Error('Verificação não encontrada.');
  var d={};try{d=JSON.parse(String(v.detalhes||'{}'));}catch(e){}
  var resultados=(d.resultados||[]).filter(function(x){return String(x.fonte)!==String(fonte);});
  resultados.push(r);

  var totalPrev=resultados.reduce(function(a,b){return a+Number(b.previsto||0)},0);
  var totalVer=resultados.reduce(function(a,b){return a+Number(b.verificado||0)},0);
  var alt=resultados.reduce(function(a,b){return a+Number(b.alteracoes||0)},0);
  var completa=resultados.length===3 && resultados.every(function(x){
    return Number(x.erros||0)===0 && Number(x.verificado||0)===Number(x.previsto||0);
  });

  var resumo={
    completa:completa,totalPrevisto:totalPrev,totalVerificado:totalVer,
    alteracoes:alt,candidatas:Number(d.candidatas||0),palavras:Number(d.palavras||0),
    buscas:Number(d.buscas||0),fontes:'Câmara, Senado, ALESP',resultados:resultados
  };
  concluirVerificacaoTecnica(token,verificationId,resumo);
  return serializar_(resumo);
}

/* ============================================================
   PESQUISA DIÁRIA — FERRAMENTA PERMANENTE
   ============================================================ */
function getPesquisaDiaria(token){
  validarSessao_(token);
  return serializar_({
    palavras:getPalavrasAtivas_(),
    fontes:[
      {fonte:'Câmara',link:'https://www.camara.leg.br/busca-portal/proposicoes/pesquisa-simplificada'},
      {fonte:'Senado',link:'https://www25.senado.leg.br/web/atividade/materias'},
      {fonte:'ALESP',link:'https://www.al.sp.gov.br/alesp/pesquisa-proposicoes/'}
    ]
  });
}

function addTermoPesquisa(token,termo){
  validarSessao_(token);
  termo=String(termo||'').trim();
  if(!termo) throw new Error('Informe o termo de pesquisa.');
  var existe=getRows_(getDb_(),'PALAVRAS_CHAVE').some(function(x){
    return semAcento_(String(x.termo||'')).toLowerCase()===semAcento_(termo).toLowerCase() && String(x.ativa)!=='Não';
  });
  if(existe) throw new Error('Esse termo já está na lista de pesquisa.');
  appendObject_('PALAVRAS_CHAVE',{id:Utilities.getUuid(),termo:termo,peso:5,ativa:'Sim'});
  return getPesquisaDiaria(token);
}

function removerTermoPesquisa(token,id){
  validarSessao_(token);
  updateById_('PALAVRAS_CHAVE',id,{ativa:'Não'});
  return getPesquisaDiaria(token);
}

/* ============================================================
   BUSCA HUMANA GUIADA
   ============================================================ */
function getBuscaGuiada(token, verificationId) {
  validarSessao_(token);
  var words=getPalavrasAtivas_();
  var feitas=getRows_(getDb_(),'BUSCAS_MANUAIS').filter(function(x){
    return String(x.verificacaoId)===String(verificationId);
  });
  var map={}; feitas.forEach(function(x){map[x.fonte]=x;});
  return serializar_({
    palavras:words.map(function(w){return w.termo;}),
    fontes:[
      {fonte:'Câmara',link:'https://www.camara.leg.br/busca-portal/proposicoes/pesquisa-simplificada',registro:map['Câmara']||null},
      {fonte:'Senado',link:'https://www25.senado.leg.br/web/atividade/materias',registro:map['Senado']||null},
      {fonte:'ALESP',link:'https://www.al.sp.gov.br/alesp/pesquisa-proposicoes/',registro:map['ALESP']||null}
    ]
  });
}

function salvarBuscaManual(token,verificationId,responsavel,fonte,resultadosEncontrados){
  validarSessao_(token);
  fonte=String(fonte||'');
  if(['Câmara','Senado','ALESP'].indexOf(fonte)<0) throw new Error('Casa legislativa inválida.');
  var n=Number(resultadosEncontrados||0);
  if(!isFinite(n)||n<0) throw new Error('Informe uma quantidade válida.');
  var words=getPalavrasAtivas_(),now=new Date();
  var existentes=getRows_(getDb_(),'BUSCAS_MANUAIS');
  var atual=existentes.find(function(x){
    return String(x.verificacaoId)===String(verificationId)&&String(x.fonte)===fonte;
  });
  var patch={
    responsavel:String(responsavel||'').trim(),data:fmtDate_(now),hora:fmtDateTime_(now),
    status:'Concluída',palavras:words.map(function(w){return w.termo;}).join('; '),
    resultadosEncontrados:n,observacao:''
  };
  if(atual) updateById_('BUSCAS_MANUAIS',atual.id,patch);
  else appendObject_('BUSCAS_MANUAIS',Object.assign({id:Utilities.getUuid(),verificacaoId:verificationId,fonte:fonte},patch));
  return getBuscaGuiada(token,verificationId);
}

function reabrirBuscaManual(token,verificationId,fonte){
  validarSessao_(token);
  var atual=getRows_(getDb_(),'BUSCAS_MANUAIS').find(function(x){
    return String(x.verificacaoId)===String(verificationId)&&String(x.fonte)===String(fonte);
  });
  if(atual) updateById_('BUSCAS_MANUAIS',atual.id,{status:'Pendente',hora:fmtDateTime_(new Date())});
  return getBuscaGuiada(token,verificationId);
}

function salvarBuscasManuaisLote(token,verificationId,responsavel,itens){
  validarSessao_(token);
  itens=itens||[];
  if(itens.length!==3) throw new Error('Informe o resultado da pesquisa nas três casas.');
  var words=getPalavrasAtivas_(), now=new Date(), existentes=getRows_(getDb_(),'BUSCAS_MANUAIS');
  itens.forEach(function(item){
    var fonte=String(item.fonte||'');
    var atual=existentes.find(function(x){return String(x.verificacaoId)===String(verificationId)&&String(x.fonte)===fonte;});
    var patch={
      responsavel:String(responsavel||'').trim(),data:fmtDate_(now),hora:fmtDateTime_(now),status:'Concluída',
      palavras:words.map(function(w){return w.termo;}).join('; '),
      resultadosEncontrados:Number(item.resultadosEncontrados||0),observacao:String(item.observacao||'').trim()
    };
    if(atual) updateById_('BUSCAS_MANUAIS',atual.id,patch);
    else appendObject_('BUSCAS_MANUAIS',Object.assign({id:Utilities.getUuid(),verificacaoId:verificationId,fonte:fonte},patch));
  });
  return getBuscaGuiada(token,verificationId);
}

function getBuscasManuaisDaVerificacao_(verificationId){
  return getRows_(getDb_(),'BUSCAS_MANUAIS').filter(function(x){
    return String(x.verificacaoId)===String(verificationId);
  });
}

/* ============================================================
   RELATÓRIOS
   ============================================================ */
function prepararRelatorio(token,verificationId){
  validarSessao_(token);
  var v=getRows_(getDb_(),'VERIFICACOES').find(function(x){return String(x.id)===String(verificationId);});
  if(!v)throw new Error('Verificação não encontrada.');
  var detalhes={};try{detalhes=JSON.parse(String(v.detalhes||'{}'));}catch(e){}
  var buscasManuais=getBuscasManuaisDaVerificacao_(verificationId);
  var concluidas=['Câmara','Senado','ALESP'].every(function(f){
    return buscasManuais.some(function(x){return String(x.fonte)===f&&String(x.status)==='Concluída';});
  });
  if(!concluidas) throw new Error('Conclua a pesquisa nas três casas antes de revisar o relatório.');
  if(String(v.status)!=='CONCLUÍDA') throw new Error('A verificação automática ainda possui pendências. Resolva antes de revisar o relatório.');
  var candidatasAvaliacao=getRows_(getDb_(),'CANDIDATAS').filter(function(x){return String(x.verificacaoId)===String(verificationId);});
  return serializar_(Object.assign({},v,{detalhes:detalhes,buscasManuais:buscasManuais,candidatasAvaliacao:candidatasAvaliacao.length}));
}
function salvarRelatorio(token,verificationId,observacao){
  validarSessao_(token);
  observacao=String(observacao||'').trim();
  if(!observacao)throw new Error('Informe a observação antes de salvar.');
  var v=getRows_(getDb_(),'VERIFICACOES').find(function(x){return String(x.id)===String(verificationId);});
  if(!v)throw new Error('Verificação não encontrada.');
  var detalhes={};try{detalhes=JSON.parse(String(v.detalhes||'{}'));}catch(e){}
  var buscasManuais=getBuscasManuaisDaVerificacao_(verificationId);
  var fontesConcluidas={};buscasManuais.forEach(function(x){if(String(x.status)==='Concluída')fontesConcluidas[x.fonte]=true;});
  if(!fontesConcluidas['Câmara']||!fontesConcluidas['Senado']||!fontesConcluidas['ALESP']){
    throw new Error('Conclua a pesquisa guiada de novas proposituras nas três casas antes de salvar o relatório.');
  }
  var emissao=fmtDateTime_(new Date());
  var report=serializar_(Object.assign({},v,{emissao:emissao,observacao:observacao,detalhes:detalhes,buscasManuais:buscasManuais}));
  updateById_('VERIFICACOES',verificationId,{emissao:emissao,status:'FINALIZADA'});
  appendObject_('RELATORIOS',{
    id:Utilities.getUuid(),verificacaoId:verificationId,data:v.data,responsavel:v.responsavel,
    inicio:v.inicio,fimTecnico:v.fimTecnico,emissao:emissao,status:v.status,observacao:observacao,
    totalPrevisto:v.totalPrevisto,totalVerificado:v.totalVerificado,alteracoes:v.alteracoes,
    candidatas:v.candidatas,palavrasAtivas:v.palavrasAtivas,buscasExecutadas:v.buscasExecutadas,
    fontes:v.fontes,snapshot:JSON.stringify(report)
  });
  return report;
}
function getRelatorios(token){
  validarSessao_(token);
  return serializar_(getRows_(getDb_(),'RELATORIOS').slice(-100).reverse());
}
function getRelatorioSalvo(token,id){
  validarSessao_(token);
  var r=getRows_(getDb_(),'RELATORIOS').find(function(x){return String(x.id)===String(id);});
  if(!r) throw new Error('Relatório não encontrado.');
  try{
    var snap=JSON.parse(String(r.snapshot||'{}'));
    if(snap && Object.keys(snap).length) return serializar_(snap);
  }catch(e){}
  // Fallback para relatórios antigos cujo snapshot não esteja disponível.
  return serializar_({
    data:r.data,responsavel:r.responsavel,inicio:r.inicio,fimTecnico:r.fimTecnico,
    emissao:r.emissao,status:r.status,observacao:r.observacao,totalPrevisto:r.totalPrevisto,
    totalVerificado:r.totalVerificado,alteracoes:r.alteracoes,candidatas:r.candidatas,
    palavrasAtivas:r.palavrasAtivas,buscasExecutadas:r.buscasExecutadas,fontes:r.fontes,
    detalhes:{},buscasManuais:[]
  });
}

/* ============================================================
   PALAVRAS
   ============================================================ */
function getPalavras(token){validarSessao_(token);return serializar_(getRows_(getDb_(),'PALAVRAS_CHAVE'));}
function addPalavra(token,termo,peso){
  validarSessao_(token);termo=String(termo||'').trim();
  if(!termo)throw new Error('Informe a palavra-chave.');
  appendObject_('PALAVRAS_CHAVE',{id:Utilities.getUuid(),termo:termo,peso:Number(peso||5),ativa:'Sim'});
  return getPalavras(token);
}
function togglePalavra(token,id,ativa){validarSessao_(token);updateById_('PALAVRAS_CHAVE',id,{ativa:ativa?'Sim':'Não'});return getPalavras(token);}
function getPalavrasAtivas_(){return getRows_(getDb_(),'PALAVRAS_CHAVE').filter(function(x){return String(x.ativa).toLowerCase()!=='não';});}

/* ============================================================
   HELPERS
   ============================================================ */

function sameDayValue_(value, isoDate){
  if (value == null || value === '') return false;
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd') === isoDate;
  }
  var s = String(value).trim();
  var m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return (m1[1]+'-'+m1[2]+'-'+m1[3]) === isoDate;
  var m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m2) return (m2[3]+'-'+m2[2]+'-'+m2[1]) === isoDate;
  var d = new Date(s);
  if (!isNaN(d)) return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') === isoDate;
  return false;
}


function aplicarCamposLegislativos_(verificationId,p,x,result){
  var patch={};
  var houveBaseline=false;

  // SITUAÇÃO: só mexe se a fonte realmente retornar uma situação.
  if(normalizar_(x.situacao||'')){
    var sitAnt=normalizar_(p.situacaoAtual||'');
    if(!sitAnt){
      patch.situacaoAtual=x.situacao;
      houveBaseline=true;
    }else if(registrarAlteracaoSeMudou_(verificationId,p,'situacaoAtual',p.situacaoAtual,x.situacao)){
      patch.situacaoAtual=x.situacao;
      result.alteracoes++;
    }else{
      patch.situacaoAtual=x.situacao;
    }
  }

  // TRAMITAÇÃO
  if(normalizar_(x.tramitacao||'')){
    var tramAnt=normalizar_(p.tramitacaoAtual||'');
    if(!tramAnt){
      patch.tramitacaoAtual=x.tramitacao;
      houveBaseline=true;
    }else if(registrarAlteracaoSeMudou_(verificationId,p,'tramitacaoAtual',p.tramitacaoAtual,x.tramitacao)){
      patch.tramitacaoAtual=x.tramitacao;
      result.alteracoes++;
    }else{
      patch.tramitacaoAtual=x.tramitacao;
    }
  }

  if(x.data) patch.dataUltimaTramitacao=x.data;
  if(x.orgao) patch.orgaoAtual=x.orgao;
  if(x.detalhe!==undefined) patch.detalheTramitacao=x.detalhe||'';

  // Mantém os campos legados sincronizados para não quebrar partes antigas.
  var resumo=[
    x.situacao?('Situação: '+x.situacao):'',
    x.tramitacao?('Tramitação: '+x.tramitacao):'',
    x.orgao?('Órgão: '+x.orgao):'',
    x.detalhe?('Detalhe: '+x.detalhe):''
  ].filter(Boolean).join(' — ');
  if(resumo){
    patch.andamento=resumo;
    patch.dataAndamento=x.data||p.dataAndamento||'';
    patch.estadoOficial=resumo;
    patch.dataEstadoOficial=x.data||p.dataEstadoOficial||'';
  }

  if(Object.keys(patch).length) updateProp_(p.id,patch);
  if(houveBaseline) result.baselines=(result.baselines||0)+1;
}

function aplicarEstadoOficial_(verificationId,p,novoTexto,novaData,result){
  var anterior=String(p.estadoOficial||'').trim();

  if(!anterior){
    updateProp_(p.id,{
      estadoOficial:novoTexto||'',
      dataEstadoOficial:novaData||'',
      andamento:novoTexto||p.andamento||'',
      dataAndamento:novaData||p.dataAndamento||''
    });
    result.baselines=(result.baselines||0)+1;
    return false;
  }

  var mudou=registrarAlteracaoSeMudou_(verificationId,p,'estadoOficial',anterior,novoTexto);
  if(mudou){
    result.alteracoes++;
    updateProp_(p.id,{
      estadoOficial:novoTexto,
      dataEstadoOficial:novaData||'',
      andamento:novoTexto,
      dataAndamento:novaData||''
    });
  }else{
    updateProp_(p.id,{
      estadoOficial:novoTexto,
      dataEstadoOficial:novaData||p.dataEstadoOficial||''
    });
  }
  return mudou;
}

function registrarAlteracaoSeMudou_(verificationId,p,campo,anterior,novo){
  var a=normalizar_(anterior),n=normalizar_(novo);
  if(!n||a===n)return false;

  // Evita registrar a mesma mudança duas vezes.
  var existente=getRows_(getDb_(),'ALTERACOES').some(function(x){
    return String(x.proposituraId||'')===String(p.id) &&
      String(x.campo||'')===String(campo) &&
      normalizar_(x.anterior||'')===a &&
      normalizar_(x.novo||'')===n &&
      (String(x.verificacaoId||'')===String(verificationId||'') || sameDayValue_(x.data,fmtDate_(new Date())));
  });
  if(existente)return false;

  appendObject_('ALTERACOES',{
    id:Utilities.getUuid(),verificacaoId:verificationId,proposituraId:p.id,fonte:p.fonte,
    propositura:labelProp_(p),campo:campo,anterior:anterior||'',novo:novo,status:'Pendente',
    data:fmtDateTime_(new Date()),observacaoAnalise:'',analisadoEm:''
  });
  return true;
}
function appendCandidata_(verificationId,fonte,id,tipo,numero,ano,ementa,hits,link){
  appendObject_('CANDIDATAS',{
    id:Utilities.getUuid(),verificacaoId:verificationId,fonte:fonte,idOficial:String(id||''),
    tipo:tipo||'',numero:String(numero||''),ano:String(ano||''),ementa:ementa||'',
    termos:hits.map(function(x){return x.termo;}).join('; '),
    pontuacao:hits.reduce(function(s,x){return s+Number(x.peso||0);},0),
    status:'Pendente',link:link||'',data:fmtDateTime_(new Date())
  });
}
function getSeen_(){
  var seen={};
  getRows_(getDb_(),'PROPOSITURAS').forEach(function(p){if(p.idOficial)seen[p.fonte+'|'+String(p.idOficial)]=true;});
  getRows_(getDb_(),'CANDIDATAS').forEach(function(p){if(p.idOficial)seen[p.fonte+'|'+String(p.idOficial)]=true;});
  return seen;
}
function fetchJson_(url){
  var r=UrlFetchApp.fetch(url,{muteHttpExceptions:true,headers:{Accept:'application/json'}});
  var code=r.getResponseCode();
  if(code<200||code>=300)throw new Error('HTTP '+code+' — '+url);
  return JSON.parse(r.getContentText('UTF-8'));
}
function findMateriaList_(obj){
  var found=[];
  walk_(obj,function(x){
    if(found.length)return;
    if(x&&typeof x==='object'&&x.Materia){
      found=Array.isArray(x.Materia)?x.Materia:[x.Materia];
    }
  });
  return found;
}
function extrairInfoMateriaSenado_(m){
  var i=m.IdentificacaoMateria||m;
  return {
    id:String(i.CodigoMateria||m.CodigoMateria||m.Codigo||''),
    tipo:String(i.SiglaSubtipoMateria||i.SiglaMateria||i.Sigla||''),
    numero:String(i.NumeroMateria||i.Numero||''),
    ano:String(i.AnoMateria||i.Ano||''),
    ementa:String(m.EmentaMateria||m.Ementa||'')
  };
}
function matchWords_(text,words){
  var t=semAcento_(normalizar_(text)).toLowerCase();
  return words.filter(function(w){return t.indexOf(semAcento_(String(w.termo||'')).toLowerCase())>=0;});
}
function uniqueWords_(arr){
  var s={},o=[];
  arr.forEach(function(x){var k=String(x.termo);if(!s[k]){s[k]=true;o.push(x);}});
  return o;
}
function tag_(block,name){
  var re=new RegExp('<'+name+'[^>]*>([\\s\\S]*?)<\\/'+name+'>','i');
  var m=re.exec(block);
  return m?decodeXml_(m[1]).trim():'';
}
function decodeXml_(s){return String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");}
function walk_(x,fn){if(!x||typeof x!=='object')return;fn(x);Object.keys(x).forEach(function(k){var v=x[k];if(v&&typeof v==='object')walk_(v,fn);});}
function toTime_(s){
  if(!s)return 0;
  var m=String(s).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if(m)return new Date(Number(m[3]),Number(m[2])-1,Number(m[1])).getTime();
  var d=new Date(s);return isNaN(d.getTime())?0:d.getTime();
}
function shortErr_(e){var s=String(e&&e.message?e.message:e);return s.length>240?s.slice(0,240)+'…':s;}
function semAcento_(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function chaveProp_(p){return [p.fonte,String(p.idOficial||''),p.tipo,p.numero,p.ano].join('|');}
function labelProp_(p){return [p.tipo,p.numero+(p.ano?'/'+p.ano:'')].filter(Boolean).join(' ');}
function normalizar_(s){return String(s==null?'':s).replace(/\s+/g,' ').trim();}
function updateProp_(id,patch){updateById_('PROPOSITURAS',id,patch);}
function fmtDate_(d){return Utilities.formatDate(d,Session.getScriptTimeZone(),'yyyy-MM-dd');}
function fmtDateTime_(d){return Utilities.formatDate(d,Session.getScriptTimeZone(),'dd/MM/yyyy HH:mm:ss');}
function fmtIso_(d){return Utilities.formatDate(d,Session.getScriptTimeZone(),'yyyy-MM-dd');}

/* BANCO */
function getDb_(){
  if(CFG.SHEET_ID)return SpreadsheetApp.openById(CFG.SHEET_ID);
  var s=SpreadsheetApp.getActiveSpreadsheet();
  if(!s)throw new Error('Defina SHEET_ID ou use um projeto vinculado à planilha.');
  return s;
}
function ensureSheet_(ss,name,headers){
  var sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);
  if(sh.getLastRow()===0){sh.getRange(1,1,1,headers.length).setValues([headers]);return;}
  var current=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  headers.forEach(function(h){
    if(current.indexOf(h)<0){sh.getRange(1,sh.getLastColumn()+1).setValue(h);current.push(h);}
  });
}
function getRows_(ss,name){
  var sh=ss.getSheetByName(name);if(!sh||sh.getLastRow()<2)return[];
  var data=sh.getDataRange().getValues(),headers=data.shift().map(String);
  return data.filter(function(r){return r.some(function(v){return v!==''&&v!==null;});}).map(function(r){
    var o={};headers.forEach(function(h,i){o[h]=r[i];});return o;
  });
}
function appendObject_(name,obj){
  var sh=getDb_().getSheetByName(name);
  var headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  sh.appendRow(headers.map(function(h){return obj[h]!==undefined?obj[h]:'';}));
}
function updateById_(name,id,patch){
  var sh=getDb_().getSheetByName(name),data=sh.getDataRange().getValues(),headers=data[0].map(String),ic=headers.indexOf('id');
  for(var r=1;r<data.length;r++){
    if(String(data[r][ic])===String(id)){
      Object.keys(patch).forEach(function(k){var c=headers.indexOf(k);if(c>=0)sh.getRange(r+1,c+1).setValue(patch[k]);});
      return;
    }
  }
}
function serializar_(v){
  if(v instanceof Date)return fmtDateTime_(v);
  if(Array.isArray(v))return v.map(serializar_);
  if(v&&typeof v==='object'){var o={};Object.keys(v).forEach(function(k){o[k]=serializar_(v[k]);});return o;}
  return v;
}

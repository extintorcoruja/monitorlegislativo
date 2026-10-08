from pathlib import Path

p=Path('Code.gs')
s=p.read_text(encoding='utf-8')
start=s.index('function atualizarRegimesAlespInterno_(props){')
end=s.index('\nfunction verificarAlesp', start)
new=r'''function atualizarRegimesAlespInterno_(props){
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
}'''
s=s[:start]+new+s[end:]
p.write_text(s,encoding='utf-8')
print('Parser JSON de regimes ALESP atualizado com aliases e diagnóstico.')

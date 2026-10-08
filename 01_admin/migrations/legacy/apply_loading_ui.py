from pathlib import Path

index = Path('Index.html')
styles = Path('Styles.html')

html = index.read_text(encoding='utf-8')
css = styles.read_text(encoding='utf-8')

loader_html = '<div id="global-loading" class="global-loading" aria-live="polite" aria-hidden="true"><span class="loading-spinner"></span><span id="global-loading-text">Processando...</span></div>'
if loader_html not in html:
    html = html.replace('<div id="toast"></div>\n<script>', '<div id="toast"></div>\n' + loader_html + '\n<script>')

old = "var token=localStorage.getItem('ml_token')||'',current=null,dash=null,viewCache={};\nfunction api(fn,args){args=args||[];return new Promise(function(ok,fail){google.script.run.withSuccessHandler(ok).withFailureHandler(function(e){var msg=String(e&&e.message?e.message:e);if(/sess[aã]o expirada/i.test(msg)){localStorage.removeItem('ml_token');token='';mostrarLogin('Sua sessão expirou. Entre novamente.');return;}fail(new Error(msg));})[fn].apply(google.script.run,args);});}"

new = """var token=localStorage.getItem('ml_token')||'',current=null,dash=null,viewCache={},loadingCount=0;
function loadingLabel(fn){fn=String(fn||'');if(fn==='login')return 'Entrando no sistema...';if(fn==='getDashboard')return 'Carregando painel...';if(/proposit/i.test(fn))return 'Carregando proposituras...';if(/alterac/i.test(fn))return 'Carregando alterações...';if(/candidat|avali/i.test(fn))return 'Carregando avaliação...';if(/relatorio/i.test(fn))return 'Carregando relatórios...';if(/verificar|reverificar|regime/i.test(fn))return 'Consultando fonte oficial...';if(/salvar|registrar|adicionar|atualizar|alterar|concluir|aprovar|ignorar|reabrir/i.test(fn))return 'Salvando alterações...';return 'Processando...';}
function showLoading(msg){loadingCount++;var el=document.getElementById('global-loading'),txt=document.getElementById('global-loading-text');if(txt)txt.textContent=msg||'Processando...';if(el){el.classList.add('show');el.setAttribute('aria-hidden','false');}}
function hideLoading(){loadingCount=Math.max(0,loadingCount-1);if(loadingCount===0){var el=document.getElementById('global-loading');if(el){el.classList.remove('show');el.setAttribute('aria-hidden','true');}}}
function api(fn,args){args=args||[];showLoading(loadingLabel(fn));return new Promise(function(ok,fail){google.script.run.withSuccessHandler(function(r){hideLoading();ok(r);}).withFailureHandler(function(e){hideLoading();var msg=String(e&&e.message?e.message:e);if(/sess[aã]o expirada/i.test(msg)){localStorage.removeItem('ml_token');token='';mostrarLogin('Sua sessão expirou. Entre novamente.');return;}fail(new Error(msg));})[fn].apply(google.script.run,args);});}"""

if old in html:
    html = html.replace(old, new)
elif 'function loadingLabel(fn)' not in html:
    raise SystemExit('Bloco api() esperado não encontrado em Index.html')

loader_css = """
<style>
.global-loading{position:fixed;top:18px;right:22px;z-index:1000;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;background:#172033;color:#fff;box-shadow:0 8px 24px #17203333;font-size:12px;font-weight:700;opacity:0;transform:translateY(-8px);pointer-events:none;transition:opacity .18s ease,transform .18s ease}
.global-loading.show{opacity:1;transform:translateY(0)}
.loading-spinner{width:16px;height:16px;border:2px solid #ffffff55;border-top-color:#fff;border-radius:50%;animation:globalSpin .75s linear infinite;flex:0 0 16px}
@keyframes globalSpin{to{transform:rotate(360deg)}}
@media(max-width:850px){.global-loading{top:12px;right:12px;left:12px;justify-content:center}}
@media print{.global-loading{display:none!important}}
</style>
"""
if '.global-loading{' not in css:
    css = css.rstrip() + '\n' + loader_css

index.write_text(html, encoding='utf-8')
styles.write_text(css, encoding='utf-8')
print('Indicador global de carregamento aplicado.')

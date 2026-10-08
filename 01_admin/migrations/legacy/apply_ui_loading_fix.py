from pathlib import Path
import re

index = Path('Index.html')
styles = Path('Styles.html')

s = index.read_text(encoding='utf-8')
old = "function sair(){localStorage.removeItem('ml_token');location.reload();}"
new = "function sair(){localStorage.removeItem('ml_token');token='';current=null;dash=null;viewCache={};loadingCount=0;hideLoading();var p=document.getElementById('pwd');if(p)p.value='';mostrarLogin('');setTimeout(function(){if(p)p.focus();},50);}"
if old in s:
    s = s.replace(old, new, 1)
index.write_text(s, encoding='utf-8')

css = styles.read_text(encoding='utf-8')
pattern = re.compile(r"<style>\n\.global-loading\{.*?@media print\{\.global-loading\{display:none!important\}\}\n</style>\s*$", re.S)
replacement = '''<style>
.global-loading{
  position:fixed;
  inset:0;
  z-index:2000;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:24px;
  background:rgba(16,41,65,.28);
  backdrop-filter:blur(2px);
  opacity:0;
  visibility:hidden;
  pointer-events:none;
  transition:opacity .16s ease,visibility .16s ease;
}
.global-loading.show{opacity:1;visibility:visible;pointer-events:auto}
.global-loading::before{
  content:'';
  position:absolute;
  width:210px;
  height:92px;
  background:#fff;
  border:1px solid #dfe5ed;
  border-radius:14px;
  box-shadow:0 18px 48px rgba(16,41,65,.22);
}
.global-loading .loading-spinner,.global-loading #global-loading-text{position:relative;z-index:1}
.global-loading .loading-spinner{
  width:25px;
  height:25px;
  border:3px solid #dce5f3;
  border-top-color:#3269d4;
  border-radius:50%;
  animation:globalSpin .75s linear infinite;
  flex:0 0 25px;
  margin-right:11px;
}
.global-loading #global-loading-text{font-size:13px;font-weight:700;color:#25344c;max-width:145px;line-height:1.35}
@keyframes globalSpin{to{transform:rotate(360deg)}}
@media(max-width:850px){.global-loading::before{width:230px}.global-loading #global-loading-text{max-width:160px}}
@media print{.global-loading{display:none!important}}
</style>
'''
css2, n = pattern.subn(replacement, css, count=1)
if n == 1:
    styles.write_text(css2, encoding='utf-8')
else:
    print('Bloco CSS de carregamento não encontrado; Styles.html mantido sem alteração.')

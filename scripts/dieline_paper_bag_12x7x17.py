import base64
logo=base64.b64encode(open('/home/claude/command-center/sites/bend/logo-white.png','rb').read()).decode()
W,G,H=12,7,17
GL=0.75          # glue flap
BOT=G/2+0.75     # bottom fold allowance = 4.25
BL=0.125; SAFE=0.5; TOPSAFE=0.75
BW=2*W+2*G+GL    # 34.75
T=1.5            # top turnover hem
BH=T+H+BOT        # 17.75
S=16.2           # px per inch
ox,oy=46,40      # origin offset px
def X(v): return ox+v*S
def Y(v): return oy+v*S
S=13.4
svg=[]
a=svg.append
# bleed
a(f'<rect x="{X(-BL)}" y="{Y(-BL)}" width="{(BW+2*BL)*S}" height="{(BH+2*BL)*S}" fill="none" stroke="#E53935" stroke-width="1" stroke-dasharray="4 3"/>')
# panels fill
xs=[0,GL,GL+W,GL+W+G,GL+2*W+G,BW]
names=['GLUE','BACK','GUSSET','FRONT','GUSSET']
fills=['#F3EEE6','#FBF8F3','#F3EEE6','#FBF8F3','#F3EEE6']
for i in range(5):
    a(f'<rect x="{X(xs[i])}" y="{Y(T)}" width="{(xs[i+1]-xs[i])*S}" height="{H*S}" fill="{fills[i]}"/>')
    a(f'<rect x="{X(xs[i])}" y="{Y(0)}" width="{(xs[i+1]-xs[i])*S}" height="{T*S}" fill="url(#hatch)" opacity=".55"/>')
    a(f'<rect x="{X(xs[i])}" y="{Y(T+H)}" width="{(xs[i+1]-xs[i])*S}" height="{BOT*S}" fill="#EDE6DA"/>')
# hatch glue flap
a(f'<rect x="{X(0)}" y="{Y(0)}" width="{GL*S}" height="{BH*S}" fill="url(#hatch)"/>')
# safe areas front/back
for x0 in (GL, GL+W+G):
    a(f'<rect x="{X(x0+SAFE)}" y="{Y(T+TOPSAFE)}" width="{(W-2*SAFE)*S}" height="{(H-TOPSAFE-SAFE)*S}" fill="none" stroke="#22A83A" stroke-width="1" stroke-dasharray="4 3"/>')
# gusset safe
for x0 in (GL+W, GL+2*W+G):
    a(f'<rect x="{X(x0+SAFE)}" y="{Y(T+TOPSAFE)}" width="{(G-2*SAFE)*S}" height="{(H-TOPSAFE-SAFE)*S}" fill="none" stroke="#22A83A" stroke-width="0.8" stroke-dasharray="2 3" opacity=".7"/>')
# fold lines (vertical panel folds)
for x in xs[1:-1]:
    a(f'<line x1="{X(x)}" y1="{Y(0)}" x2="{X(x)}" y2="{Y(BH)}" stroke="#1E63C6" stroke-width="1" stroke-dasharray="6 3"/>')
# gusset center folds
for x0 in (GL+W, GL+2*W+G):
    a(f'<line x1="{X(x0+G/2)}" y1="{Y(0)}" x2="{X(x0+G/2)}" y2="{Y(T+H)}" stroke="#1E63C6" stroke-width="1" stroke-dasharray="6 2 1.5 2"/>')
# bottom fold lines
a(f'<line x1="{X(0)}" y1="{Y(T)}" x2="{X(BW)}" y2="{Y(T)}" stroke="#1E63C6" stroke-width="1" stroke-dasharray="6 3"/>')
a(f'<line x1="{X(0)}" y1="{Y(T+H)}" x2="{X(BW)}" y2="{Y(T+H)}" stroke="#1E63C6" stroke-width="1" stroke-dasharray="6 3"/>')
a(f'<line x1="{X(0)}" y1="{Y(T+H+G/2)}" x2="{X(BW)}" y2="{Y(T+H+G/2)}" stroke="#1E63C6" stroke-width="0.8" stroke-dasharray="6 2 1.5 2"/>')
# gusset bottom diagonals (crease guides)
for x0 in (GL+W, GL+2*W+G):
    a(f'<polyline points="{X(x0)},{Y(T+H+G/2)} {X(x0+G/2)},{Y(T+H)} {X(x0+G)},{Y(T+H+G/2)}" fill="none" stroke="#1E63C6" stroke-width="0.8" stroke-dasharray="3 2"/>')
# cut outline (top edge serrated look via zigzag)
zz=[]; n=int(BW/0.25)
for i in range(n+1):
    xx=BW*i/n; zz.append(f'{X(xx)},{Y(0 if i%2==0 else 0.08)}')
a(f'<line x1="{X(0)}" y1="{Y(0)}" x2="{X(BW)}" y2="{Y(0)}" stroke="#D6007E" stroke-width="1.6"/>')
a(f'<polyline points="{X(BW)},{Y(0)} {X(BW)},{Y(BH)} {X(0)},{Y(BH)} {X(0)},{Y(0)}" fill="none" stroke="#D6007E" stroke-width="1.6"/>')
for x0 in (GL, GL+W+G):
    for hx in (x0+W/2-2.25, x0+W/2+0.75):
        a(f'<rect x="{X(hx)}" y="{Y(0.15)}" width="{1.5*S}" height="{0.7*S}" fill="none" stroke="#8A7F6E" stroke-width=".8" stroke-dasharray="2 2"/>')
    a(f'<text x="{X(x0+W/2)}" y="{Y(1.3)}" class="ps">handle patches (inside)</text>')
a(f'<text x="{X(GL+W+G/2)}" y="{Y(1.3)}" class="ps">top turnover</text>')
# labels
lab=['GLUE','BACK PANEL','GUSSET','FRONT PANEL','GUSSET']
for i in range(5):
    cx=X((xs[i]+xs[i+1])/2)
    if i==0:
        a(f'<text x="{cx}" y="{Y(T+H/2)}" transform="rotate(-90 {cx} {Y(T+H/2)})" class="pl">GLUE FLAP</text>')
    else:
        a(f'<text x="{cx}" y="{Y(T+H/2)}" class="pl">{lab[i]}</text>')
        if i in (1,3): a(f'<text x="{cx}" y="{Y(T+H/2)+14}" class="ps">safe print area {W-2*SAFE:g} x {H-TOPSAFE-SAFE:g} in</text>')
    a(f'<text x="{cx}" y="{Y(T+H+BOT/2)+3}" class="ps">{"BOTTOM" if i else ""}</text>')
# dims
def hdim(x1,x2,y,txt,up=True):
    ty=y-5 if up else y+12
    a(f'<line x1="{X(x1)}" y1="{y}" x2="{X(x2)}" y2="{y}" class="d" marker-start="url(#a)" marker-end="url(#a)"/>')
    a(f'<line x1="{X(x1)}" y1="{y-5}" x2="{X(x1)}" y2="{y+5}" class="dt"/><line x1="{X(x2)}" y1="{y-5}" x2="{X(x2)}" y2="{y+5}" class="dt"/>')
    a(f'<text x="{(X(x1)+X(x2))/2}" y="{ty}" class="dl">{txt}</text>')
def vdim(y1,y2,x,txt):
    a(f'<line x1="{x}" y1="{Y(y1)}" x2="{x}" y2="{Y(y2)}" class="d" marker-start="url(#a)" marker-end="url(#a)"/>')
    a(f'<line x1="{x-5}" y1="{Y(y1)}" x2="{x+5}" y2="{Y(y1)}" class="dt"/><line x1="{x-5}" y1="{Y(y2)}" x2="{x+5}" y2="{Y(y2)}" class="dt"/>')
    m=(Y(y1)+Y(y2))/2
    a(f'<text x="{x-6}" y="{m}" transform="rotate(-90 {x-6} {m})" class="dl">{txt}</text>')
mm=lambda v: f'{v*25.4:.1f}'.rstrip('0').rstrip('.')
top=Y(-BL)-10
hdim(0,GL,top,f'{GL:g}',True)
hdim(GL,GL+W,top,f'{W:g} in ({mm(W)} mm)')
hdim(GL+W,GL+W+G,top,f'{G:g} in ({mm(G)} mm)')
hdim(GL+W+G,GL+2*W+G,top,f'{W:g} in ({mm(W)} mm)')
hdim(GL+2*W+G,BW,top,f'{G:g} in ({mm(G)} mm)')
hdim(0,BW,Y(BH+BL)+22,f'Flat blank width {BW:g} in ({mm(BW)} mm)',False)
vdim(0,BH,X(-BL)-14,f'{BH:g} in ({mm(BH)} mm)')
vdim(0,T,X(BW+BL)+24,f'{T:g}')
vdim(T,T+H,X(BW+BL)+24,f'{H:g} in ({mm(H)} mm) bag height')
vdim(T+H,BH,X(BW+BL)+24,f'{BOT:g} in')
svgw=X(BW)+48; svgh=Y(BH)+52
SVG=f'''<svg viewBox="0 0 {svgw} {svgh}" width="{svgw}" height="{svgh}" xmlns="http://www.w3.org/2000/svg">
<defs><marker id="a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="#1F2A24"/></marker>
<pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#B9AE9C" stroke-width="1"/></pattern></defs>
<style>.pl{{font:700 9px Lexend,sans-serif;fill:#8A7F6E;text-anchor:middle;letter-spacing:.08em}}.ps{{font:500 7px Lexend,sans-serif;fill:#8A7F6E;text-anchor:middle}}.d{{stroke:#1F2A24;stroke-width:.8}}.dt{{stroke:#1F2A24;stroke-width:.6}}.dl{{font:600 7.5px Lexend,sans-serif;fill:#1F2A24;text-anchor:middle}}</style>
{"".join(svg)}</svg>'''

k=4.6  # px per inch for preview
fw,fh,gd=W*k,H*k,G*k*0.55
dx,dy=gd*0.85,-gd*0.5
x0,y0=40,30-dy+5.2*k
PRE=f"""<svg width="{fw+dx+80}" height="{fh-dy+60+5.2*k}" viewBox="0 0 {fw+dx+80} {fh-dy+60+5.2*k}" xmlns="http://www.w3.org/2000/svg">
<polygon points="{x0+fw},{y0} {x0+fw+dx},{y0+dy} {x0+fw+dx},{y0+fh+dy} {x0+fw},{y0+fh}" fill="#B98E5E"/>
<polygon points="{x0+fw},{y0} {x0+fw+dx/2},{y0+dy/2+10} {x0+fw+dx},{y0+dy}" fill="#A47C50"/>
<line x1="{x0+fw+dx/2}" y1="{y0+dy/2+10}" x2="{x0+fw+dx/2}" y2="{y0+fh+dy/2}" stroke="#9A7347" stroke-width="1"/>
<path d="M{x0+fw/2-2.2*k},{y0+4} C{x0+fw/2-2.2*k},{y0-5.5*k} {x0+fw/2+2.2*k},{y0-5.5*k} {x0+fw/2+2.2*k},{y0+4}" fill="none" stroke="#8E6A42" stroke-width="4" stroke-linecap="round"/>
<rect x="{x0}" y="{y0}" width="{fw}" height="{fh}" fill="#C9A06F"/>
<line x1="{x0}" y1="{y0+T*k}" x2="{x0+fw}" y2="{y0+T*k}" stroke="#A9814F" stroke-width="1"/>
<rect x="{x0+0.5*k}" y="{y0+0.75*k}" width="{9*k}" height="{10.75*k}" fill="none" stroke="#5E7F4E" stroke-dasharray="3 3" opacity=".7"/>
<text x="{x0+fw/2}" y="{y0+fh/2}" text-anchor="middle" style="font:700 6.5px Lexend,sans-serif;fill:#6E5131;letter-spacing:.06em">YOUR LOGO</text>
<text x="{x0+fw/2}" y="{y0+fh+22}" text-anchor="middle" style="font:600 8px Lexend,sans-serif;fill:#1F2A24">12 in W</text>
<text x="{x0+fw+dx/2+8}" y="{y0+fh+dy/2+18}" text-anchor="middle" style="font:600 8px Lexend,sans-serif;fill:#1F2A24">7 in</text>
<text x="{x0-8}" y="{y0+fh/2}" transform="rotate(-90 {x0-8} {y0+fh/2})" text-anchor="middle" style="font:600 8px Lexend,sans-serif;fill:#1F2A24">17 in H</text>
</svg>"""
spec=[('Item','12 x 7 x 17 in twisted handle kraft bag'),('SKU','NK12717'),('Bag size','12 in W x 7 in gusset x 17 in H'),('Metric','304.8 x 177.8 x 431.8 mm'),('Flat blank',f'{BW:g} x {BH:g} in'),('Glue flap',f'{GL:g} in'),('Top turnover',f'{T:g} in (handle patches inside)'),('Bottom fold',f'{BOT:g} in (gusset/2 + 0.75 in)'),('Safe print area',f'{W-2*SAFE:g} x {H-TOPSAFE-SAFE:g} in per panel'),('Paper','Brown kraft, 110 GSM'),('Handles','Twisted paper, 2 per bag')]
rows=''.join(f'<tr><td>{k}</td><td>{v}</td></tr>' for k,v in spec)
html=f'''<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
@page{{size:11in 8.5in;margin:0}}*{{box-sizing:border-box}}
body{{margin:0;width:11in;height:8.5in;font-family:Lexend,sans-serif;color:#1F2A24;background:#fff;position:relative}}
.hd{{background:#1B8A3A;height:.95in;display:flex;align-items:center;justify-content:space-between;padding:0 .4in;border-bottom:4px solid #146B2C}}
.hd img{{height:.55in}}.hd .t{{text-align:right;color:#fff}}.hd h1{{margin:0;font-size:22px;font-weight:800;letter-spacing:.01em}}.hd p{{margin:4px 0 0;font-size:10px;opacity:.9}}
.wrap{{display:flex;gap:.16in;padding:.2in .3in 0}}
.card{{background:#FAFBFA;border:1px solid #E3E8E4;border-radius:9px;padding:12px 14px}}
.draw{{width:7.45in;height:6.55in;position:relative}}
.side{{flex:1;display:flex;flex-direction:column;gap:.12in}}
h3{{margin:0 0 7px;font-size:9px;font-weight:700;letter-spacing:.08em;color:#1B8A3A;text-transform:uppercase}}
.note{{position:absolute;top:12px;right:14px;font-size:8px;color:#5B6660}}
table{{width:100%;border-collapse:collapse;font-size:8.2px}}td{{padding:3.2px 0;border-bottom:1px solid #E3E8E4;vertical-align:top}}td:first-child{{color:#5B6660;width:42%}}td:last-child{{font-weight:600}}
.key div{{display:flex;align-items:center;gap:7px;font-size:8.2px;margin:3px 0}}.key span{{display:inline-block;width:26px;height:0;border-top-width:1.6px}}
ul{{margin:0;padding-left:13px;font-size:8.2px;line-height:1.45}}
.ap{{font-size:8.2px;color:#5B6660}}.ap div{{border-bottom:1px solid #D5DBD7;padding:9px 0 3px}}
.ft{{position:absolute;bottom:0;left:0;right:0;height:.42in;border-top:3px solid #1B8A3A;display:flex;justify-content:space-between;align-items:center;padding:0 .4in;font-size:8.5px;color:#3A4540}}
svg{{display:block;margin:14px auto 0;max-width:100%;height:auto}}
</style></head><body>
<div class="hd"><img src="data:image/png;base64,{logo}"><div class="t"><h1>DIE LINE: 12 x 7 x 17 PAPER BAG</h1><p>Twisted handle kraft paper bag (NK12717), flat print layout &nbsp;|&nbsp; Rev A &nbsp;|&nbsp; November 6, 2026</p></div></div>
<div class="wrap">
<div class="card draw"><h3>Print Layout (Flat Blank)</h3><div class="note">Scale about 1:7. Dimensions in inches (mm).</div>{SVG}
<div style="font-size:7.5px;color:#5B6660;text-align:center;margin-top:2px">Hatched glue flap and bottom fold area: no print. Gussets print optional (light green safe guide). Hatched top turnover folds inside.</div>
<div style="display:flex;align-items:center;justify-content:center;gap:30px;margin-top:6px">{PRE}<div style="font-size:8px;color:#5B6660;max-width:2.3in;line-height:1.5"><b style="color:#1F2A24">Finished bag preview</b><br>Brown kraft 110 GSM, twisted paper handles. Front shown with the panel safe area. For reference only.</div></div></div>
<div class="side">
<div class="card"><h3>Specifications</h3><table>{rows}</table></div>
<div class="card key"><h3>Line Key</h3>
<div><span style="border-top:1.6px solid #D6007E"></span>Cut line (blank outline)</div>
<div><span style="border-top:1.4px dashed #E53935"></span>Bleed (0.125 in)</div>
<div><span style="border-top:1.4px dashed #22A83A"></span>Safe print area</div>
<div><span style="border-top:1.4px dashed #1E63C6"></span>Fold / crease line</div>
<div><span style="border-top:1px solid #1F2A24"></span>Dimension</div>
<h3 style="margin-top:9px">Artwork Requirements</h3>
<ul><li>1 to 2 spot colors (flexo), Pantone called out</li><li>Keep all art inside the {W-2*SAFE:g} x {H-TOPSAFE-SAFE:g} in panel safe areas</li><li>No print on glue flap, top turnover or bottom fold</li><li>Min line 0.5 pt, min text 6 pt</li><li>Vector PDF or AI, fonts outlined</li></ul></div>
<div class="card"><h3>Notes</h3><ul><li>Die line layer is for reference only; do not print it.</li><li>Confirm paper weight, handle color and ink colors with beyondGREEN before plates are made.</li><li>Final dimensions to be verified against a physical sample.</li></ul>
<h3 style="margin-top:9px">Approval</h3><div class="ap"><div>Approved by</div><div>Date</div></div></div>
</div></div>
<div class="ft"><div><b>beyondGREEN biotech, Inc.</b> &nbsp;|&nbsp; 1202 E. Wakeham Ave., Santa Ana, CA 92705</div><div>(866) 364-9466 &nbsp;|&nbsp; beyondgreenbiotech.com</div></div>
</body></html>'''
open('bag17.html','w').write(html)

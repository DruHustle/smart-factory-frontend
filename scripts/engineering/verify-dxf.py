#!/usr/bin/env python3
"""Independent CAD/PDF verification only; not an application dependency."""
import json,os,sys,re
from pathlib import Path
root=Path(sys.argv[1]).resolve()
os.environ['MPLCONFIGDIR']=str(root/'matplotlib-cache')
os.environ['XDG_CACHE_HOME']=str(root/'cache')
import ezdxf
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from ezdxf.addons.drawing import Frontend,RenderContext
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
from ezdxf.addons.drawing.config import Configuration, BackgroundPolicy, ColorPolicy
from pypdf import PdfReader
def sheet_filter(entity, sheet):
 if entity.dxftype() == 'LWPOLYLINE': x = entity.get_points()[0][0]
 elif entity.dxftype() == 'CIRCLE': x = entity.dxf.center.x
 elif entity.dxftype() in {'TEXT','INSERT'}: x = entity.dxf.insert.x
 else: return False
 return sheet * 450 <= x < sheet * 450 + 420
results=[]
for mode in ['process','electrical']:
 receipt=json.loads((root/f'{mode}.json').read_text());doc=ezdxf.readfile(root/f'{mode}.dxf');audit=doc.audit()
 assert not audit.errors and not audit.fixes,(audit.errors,audit.fixes)
 assert doc.units==4 and doc.dxfversion=='AC1021'
 assert all(layer in doc.layers for layer in ['SF_EQUIPMENT','SF_TAGS','SF_TERMINALS','SF_PROCESS','SF_POWER','SF_EARTH'])
 assert doc.layers.get('SF_POWER').dxf.lineweight==50
 assert not any(e.dxftype() in {'IMAGE','PDFUNDERLAY','OLE2FRAME'} for e in doc.modelspace())
 refs={c[k] for c in receipt['document']['connections'] for k in ['from','to']}
 seen=set()
 for insert in doc.modelspace().query('INSERT'):
  attributes={a.dxf.tag:a.dxf.text for a in insert.attribs}
  assert set(attributes)=={'TAG','REF','NAME','TYPE'}
  assert attributes['REF'] in refs
  seen.add(attributes['REF'])
 assert seen==refs
 doc.saveas(root/f'{mode}-roundtrip.dxf');reread=ezdxf.readfile(root/f'{mode}-roundtrip.dxf')
 assert len(reread.modelspace())==len(doc.modelspace()) and not reread.audit().errors
 for sheet in range(len(receipt['sheets'])):
  fig=plt.figure(figsize=(14,9.9));ax=fig.add_axes([0,0,1,1]);ax.set_facecolor('white');Frontend(RenderContext(doc),MatplotlibBackend(ax, adjust_figure=False), config=Configuration(background_policy=BackgroundPolicy.WHITE, color_policy=ColorPolicy.BLACK)).draw_layout(doc.modelspace(),finalize=True,filter_func=lambda entity: sheet_filter(entity,sheet))
  ax.set_xlim(sheet*450,sheet*450+420);ax.set_ylim(0,297);ax.set_aspect('equal',adjustable='box');ax.autoscale(False);
  for artist in ax.get_children():
   artist.set_clip_on(True);artist.set_clip_path(ax.patch)
  fig.savefig(root/f'{mode}-cad-{sheet+1}.png',dpi=130,facecolor='white');plt.close(fig)
 pdf=root/f'{mode}.pdf'
 if pdf.exists():
  reader=PdfReader(pdf);assert len(reader.pages)==len(receipt['sheets'])
  text='\n'.join(p.extract_text() for p in reader.pages)
  for page in reader.pages:
   assert abs(float(page.mediabox.width)-420/25.4*72)<1 and abs(float(page.mediabox.height)-297/25.4*72)<1
   assert not page.images,'PDF must contain vector geometry/text, not a screenshot'
  for value in [receipt['document']['drawing']['number'],'SCHEMATIC - NTS','ILLUSTRATIVE DEMO']:
   assert value in text,value
  for c in receipt['document']['connections']:
   assert all(re.sub(r'\s+', '', c[field]) in re.sub(r'\s+', '', text) for field in ['id','designation','fromTerminal','toTerminal'])
 results.append({'mode':mode,'units':'mm','version':doc.dxfversion,'auditErrors':0,'auditFixes':0,'blocksWithAttributes':len(list(doc.modelspace().query('INSERT'))),'roundTrip':True,'sheets':len(receipt['sheets']),'pdfChecked':pdf.exists()})
(root/'independent-cad-verification.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))

// Interfaz de DT: mismos grupos de trabajo que el escritorio, con controles táctiles.
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
const $=id=>document.getElementById(id);
const clone=value=>JSON.parse(JSON.stringify(value));
const date=value=>String(value||'').slice(0,10);
const labels={Titulo:'Título',Capitulo:'Capítulo',Subcapitulo:'Subcapítulo',NumeroParte:'N.º de parte',MapeoJson:'Distribución avanzada de la plantilla (JSON)',NumObra:'N.º de obra',NumeroObra:'N.º de obra',DescripcionObra:'Descripción de la obra',TituloObra:'Título de obra',FechaPedido:'Fecha del pedido',FechaEntrega:'Fecha de entrega',OT:'Orden de trabajo',NumeroPedido:'N.º de pedido',TrabajoEspecifico:'Trabajo específico',ClienteId:'Cliente',ObraId:'Obra',PlantillaId:'Plantilla',OperarioId:'Operario',OperarioIds:'Integrantes de la cuadrilla',CalcularHorario:'Calcular según horario',HorasManuales:'Horas indicadas',MismaMarca:'Mantener la misma marca',DescripcionSolicitud:'Descripción de la solicitud',PedidoPor:'Pedido por',DescripcionCambio:'Descripción del cambio',FuenteConvenio:'Fuente del convenio',HorasJornada:'Horas de jornada',HorasAnuales:'Horas anuales',AsuntosPropios:'Asuntos propios',AnioInicio:'Año de inicio del cómputo',SaldoInicial:'Saldo inicial',Pdf:'Calendario PDF',Naturales:'Contar días naturales',OtroDpto:'Otro departamento',OtroDptoNotas:'Notas de departamento',NumHoras:'Horas',TipoHora:'Tipo de hora',NumOperario:'Operario',km:'Kilómetros',N:'Niveles',NNulo:'Niveles vacíos',EnInventario:'Figura en inventario',DescontadoOrigen:'Descontado en origen'};
const label=name=>labels[name]||name.replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g,'$1 $2').replace(/Anio/g,'Año').replace(/Descripcion/g,'Descripción');
const autoFields=new Set(['Id','Version','Revision','RevisionDatos','Creado','Modificado','Suma','DescontadoOrigen','EstadoExportacion','FechaExportacion','ArchivoExportado','FormatoExportado']);

export class DesktopUI{
 constructor(ctx){
  this.ctx=ctx;this.view='calendario';this.selected=null;this.worker=0;this.filter='';this.day='';this.modelDialog=el('dialog',undefined,'pc-editor');document.body.append(this.modelDialog);
  $('workspace').classList.add('pc-workspace');document.querySelector('header h1').textContent='Control partes diarios';
  const menu=el('div',undefined,'pc-menubar');menu.setAttribute('aria-label','Menú principal de DT');
  const groups={Archivo:[['Calendario','calendario'],['Mis partes diarios','partes'],['Cerrar sesión','salir']],Estadísticas:[['Mes','estadistica:mes'],['Mes · Tipo de hora','estadistica:tipo'],['Lista de partes diarios','partes']],Herramientas:[['Calendario laboral y vacaciones','laboral:calendarios'],['Partes de operarios','operarios'],['Usuarios','usuarios'],['Hojas de necesidades','necesidades'],['Cambios de obra','cambios'],['Existencias por obra','existencias'],['Sincronizar con Dropbox','sincronizacion'],['Historial de cambios','historial'],['Diagnóstico','diagnostico'],['Opciones','opciones']],Gestión:[['N.º de obras','catalogo:obras'],['Capítulos de obra','catalogo:capitulos'],['Centros de coste','catalogo:centros'],['Tipos de hora','catalogo:tipos'],['Clientes','catalogo:clientes'],['Jefes de obra','catalogo:jefes'],['Departamentos','catalogo:departamentos'],['Partes de obra','obras'],['Catálogos de obra','obra-catalogo:Obras']]};
  for(const [name,items] of Object.entries(groups)){const details=el('details'),summary=el('summary',name),list=el('div',undefined,'pc-menu-items');for(const [title,view] of items){const button=this.button(title,()=>{details.open=false;this.open(view);});if(['operarios','usuarios','historial','diagnostico'].includes(view))button.dataset.admin='true';list.append(button);}details.append(summary,list);menu.append(details);}
  const bar=el('div',undefined,'pc-commandbar');for(const [text,view,icon] of [['Calendario','calendario','calendario'],['Partes diarios','partes','partes_operarios'],['Partes de obra','obras','partes_operarios'],['Necesidades','necesidades','necesidades'],['Cambios de obra','cambios','cambios_obra'],['Usuarios','usuarios','usuarios']]){const button=this.button(text,()=>this.open(view));const image=el('img');image.src=`assets/${icon}.png`;image.alt='';image.width=image.height=32;button.prepend(image);if(view==='usuarios')button.dataset.admin='true';bar.append(button);}
  const scope=el('label','Calendario del operario ');this.workerSelect=el('select');this.workerSelect.id='pc-worker';scope.append(this.workerSelect);this.workerSelect.addEventListener('change',()=>{this.worker=Number(this.workerSelect.value);this.selected=null;this.render();});
  const selector=el('div',undefined,'pc-scope');selector.append(scope);$('workspace').prepend(menu,bar,selector);
  const nav=$('workspace').querySelector('nav');nav.classList.add('pc-tabs');nav.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{this.view=b.dataset.view;this.day='';this.render();}));
  this.module=el('section',undefined,'view pc-module');this.module.id='pc-module';this.module.hidden=true;$('workspace').append(this.module);
  this.search=el('input');this.search.type='search';this.search.placeholder='Buscar en la vista';this.search.setAttribute('aria-label','Buscar en la vista');this.search.addEventListener('input',()=>{this.filter=this.search.value;this.renderContent();});
  const toolbar=$('workspace').querySelector('.toolbar');toolbar.append(this.search);toolbar.prepend(this.button('Anterior',()=>this.changeMonth(-1)),this.button('Hoy',()=>this.setMonth(this.ctx.today().slice(0,7))),this.button('Siguiente',()=>this.changeMonth(1)));
  $('new').textContent='Nuevo parte';$('sync').textContent='Sincronizar';
 }
 get state(){return this.ctx.state();}get full(){return this.state?.completo;}get admin(){return this.full?.administrador===true;}
 button(text,action,cls){const button=el('button',text,cls);button.type='button';button.addEventListener('click',async()=>{try{await action();}catch(error){this.ctx.error(error);}});return button;}
 actions(...buttons){const bar=el('div',undefined,'pc-actions');bar.append(...buttons);return bar;}
 note(text){return el('p',text,'notice');}
 async open(view){if(view==='salir'){$('logout').click();return;}this.view=view;this.selected=null;this.filter='';this.search.value='';this.render();}
 changeMonth(offset){const [y,m]=$('month').value.split('-').map(Number),d=new Date(y,m-1+offset,1);this.setMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);}
 setMonth(value){$('month').value=value;$('month').dispatchEvent(new Event('change'));this.day='';}
 dataParts(){const own=this.state?.partes||[];if(!this.admin||this.worker===this.ctx.profile()?.operario)return own;return(this.full.partes_administrador||[]).filter(p=>!this.worker||p.NumOperario===this.worker).map(p=>({id_local:p.Id,fecha:date(p.Fecha),operario:p.NumOperario,obra:p.NumObra,titulo:p.TituloObra,horas:String(p.NumHoras??''),tipo_hora:p.TipoHora,km:String(p.KM??'0'),notas:p.Notas||'',niveles:Array.from({length:8},(_,i)=>p['N'+(i+1)]),entregado:!!p.Entregado}));}
 visibleParts(){const month=$('month').value,q=this.filter.toLocaleLowerCase('es');return this.dataParts().filter(p=>p.fecha.startsWith(month)&&(!this.day||p.fecha===this.day)&&(!q||[p.fecha,p.obra,p.titulo,p.tipo_hora,p.notas].join(' ').toLocaleLowerCase('es').includes(q)));}
 render(){
  if(!this.state)return;const profile=this.ctx.profile();if(!profile)return;
  if(!this.workerInitialized){this.worker=profile.operario;this.workerInitialized=true;}
  const workers=this.admin?(this.full.operarios||this.full.usuarios):[{Numero:profile.operario,Nombre:profile.nombre}];this.workerSelect.replaceChildren();if(this.admin){const all=el('option','Todos los operarios');all.value='0';this.workerSelect.append(all);}for(const w of workers){const option=el('option',`${w.Numero} · ${w.Nombre||''}`);option.value=w.Numero;this.workerSelect.append(option);}this.workerSelect.value=String(this.worker);this.workerSelect.disabled=!this.admin;
  $('workspace').querySelectorAll('[data-admin]').forEach(button=>button.hidden=!this.admin);
  for(const section of $('workspace').querySelectorAll('.view'))section.hidden=section.id!==this.view;
  for(const button of $('workspace').querySelectorAll('[data-view]')){if(button.dataset.view===this.view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
  this.module.hidden=['partes','calendario','vacaciones'].includes(this.view);
  $('sync-info').textContent=`${this.ctx.cloud()?'Dropbox':'PC local'} · Datos del ${new Date(this.state.fecha*1000).toLocaleString('es-ES')} · ${this.ctx.pending().filter(p=>p.state!=='aplicado').length} envío(s) pendiente(s)`;
  this.renderContent();
 }
 renderContent(){
  if(!this.state)return;
  if(this.view==='partes'){this.renderParts();return;}
  if(this.view==='calendario'){this.renderCalendar();return;}
  if(this.view==='vacaciones'){this.ctx.balances();return;}
  const area=this.module;area.replaceChildren();
  if(this.view==='sincronizacion'){this.renderPending(area);return;}
  if(this.view==='opciones'){this.options(area);return;}
  if(!this.full){area.append(el('h2','Módulos completos de DT'),this.note(this.state.completo_error||'El escritorio todavía no ha preparado los módulos completos.'),el('p','Las pantallas necesitan los datos y servicios de la ampliación de escritorio. Sincroniza después de instalarla.'));return;}
  if(this.view.startsWith('catalogo:'))return this.catalog(area,this.view.split(':')[1]);
  if(this.view.startsWith('obra-catalogo:'))return this.workCatalog(area,this.view.split(':')[1]);
  if(this.view.startsWith('laboral:'))return this.laboral(area,this.view.split(':')[1]);
  if(this.view.startsWith('estadistica:'))return this.statistics(area,this.view.endsWith(':tipo'));
  if(this.view==='usuarios')return this.users(area);
  if(this.view==='obras')return this.documents(area,'Partes','DocumentoObra','Partes de obra','obra.guardar');
  if(this.view==='necesidades')return this.documents(area,'Necesidades','HojaNecesidades','Hojas de necesidades','necesidad.guardar');
  if(this.view==='cambios')return this.documents(area,'CambiosMaterial','CambioMaterialObra','Cambios de obra','cambio.guardar');
  if(this.view==='existencias'){area.append(el('h2','Existencias por obra'));return this.table(area,this.full.obra.Existencias,['Obra','Codigo','Concepto','Marca','Referencia','Unidades']);}
  if(this.view==='historial'){area.append(el('h2','Historial de cambios'));return this.table(area,this.full.historial,['FechaUtc','Usuario','Entidad','Clave','Accion']);}
  if(this.view==='operarios'){area.append(el('h2','Partes de operarios'),this.note('Selecciona el operario en el filtro superior y el mes de trabajo.'));area.append(this.actions(this.button('Ver partes',()=>this.open('partes')),this.button('Abrir día para editar',()=>this.openAdminDay()),this.button('Preparar partes de equipo',()=>this.openTeam())));return;}
  if(this.view==='diagnostico'){area.append(el('h2','Diagnóstico de DT'));const rows=[{Dato:'Protocolo de intercambio',Valor:this.full.contrato},{Dato:'Partes de obra',Valor:this.full.obra.Partes.length},{Dato:'Hojas de necesidades',Valor:this.full.obra.Necesidades.length},{Dato:'Cambios de obra',Valor:this.full.obra.CambiosMaterial.length},{Dato:'Registros de existencias',Valor:this.full.obra.Existencias.length},{Dato:'Cambios pendientes del móvil',Valor:this.ctx.pending().filter(p=>p.state!=='aplicado').length}];return this.table(area,rows,['Dato','Valor']);}
 }
 table(area,rows,columns,onSelect){
  const query=this.filter.toLocaleLowerCase('es');const shown=(rows||[]).filter(row=>!query||columns.some(c=>String(row[c]??'').toLocaleLowerCase('es').includes(query)));
  if(!shown.length){area.append(el('p','No hay registros para esta vista o filtro.','empty'));return;}
  const wrap=el('div',undefined,'table-wrap'),table=el('table'),head=el('thead'),hr=el('tr');for(const col of columns){const th=el('th',label(col));th.scope='col';hr.append(th);}head.append(hr);table.append(head);const body=el('tbody');
  for(const row of shown){const tr=el('tr');if(onSelect){tr.tabIndex=0;tr.setAttribute('aria-selected','false');const select=()=>{for(const r of body.children)r.setAttribute('aria-selected','false');tr.setAttribute('aria-selected','true');onSelect(row);};tr.addEventListener('click',select);tr.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});}
   for(const col of columns){let value=row[col];if(typeof value==='boolean')value=value?'Sí':'No';if(Array.isArray(value))value=value.length+' línea(s)';const td=el('td',value??'');if(['NumHoras','horas','Unidades','Recibido','Pendiente'].includes(col))td.className='number';tr.append(td);}body.append(tr);
  }table.append(body);wrap.append(table);area.append(wrap);area.append(el('p',shown.length+' registro(s)','muted'));
 }
 renderParts(){
  const area=$('parts-list');area.replaceChildren();const rows=this.visibleParts();const title=$('partes').querySelector('h2');title.textContent=this.day?'Parte diario · '+this.day:'Partes diarios';
  area.append(this.actions(this.button('Nuevo',()=>this.ctx.edit()),this.button('Editar',()=>this.editSelected()),this.button('Eliminar',()=>this.deleteSelected()),this.button('Copiar para hoy',()=>{const p=this.requireSelection();this.ctx.edit({...p,id:undefined,revision:undefined,fecha:this.ctx.today()});}),this.button('Exportar Excel',()=>this.exportDaily(rows)),this.button('Marcar enviados',()=>this.markDaily(rows,true)),this.button('Marcar pendientes',()=>this.markDaily(rows,false))));
  if(this.day)area.append(this.button('Mostrar todo el mes',()=>{this.day='';this.renderContent();}));
  this.table(area,rows.map(p=>({...p,estado:p.entregado?'Enviado':'Pendiente'})),['fecha','operario','obra','titulo','horas','tipo_hora','km','estado','notas'],row=>this.selected=row);
 }
 requireSelection(){if(!this.selected)throw new Error('Selecciona primero una fila de la lista.');return this.selected;}
 editSelected(){const p=this.requireSelection();if(p.id)this.ctx.edit(p);else this.openAdminDay(p.fecha,p.operario);}
 async deleteSelected(){const p=this.requireSelection();if(p.id)await this.ctx.remove(p);else await this.openAdminDay(p.fecha,p.operario);}
 async exportDaily(rows){const ids=rows.map(p=>p.id_local).filter(Boolean);if(!ids.length)throw new Error('No hay partes confirmados en el escritorio para exportar.');await this.command('diario.exportar',{ids});}
 async markDaily(rows,enviado){const ids=this.selected?[this.selected.id_local]:rows.map(p=>p.id_local);if(!ids.length||ids.some(id=>!id))throw new Error('Primero confirma los partes con el escritorio.');await this.command('diario.estado',{ids,enviado});}
 renderCalendar(){
  const parts=this.visibleParts();const queued=this.ctx.pending().filter(p=>p.kind!=='Comando'&&p.parte);
  this.ctx.calendar(parts,queued,this.worker);const cells=$('calendar').children;const month=$('month').value,[year,m]=month.split('-').map(Number),offset=(new Date(year,m-1,1).getDay()+6)%7;
  for(let d=1;d<=new Date(year,m,0).getDate();d++){const cell=cells[7+offset+d-1],value=month+'-'+String(d).padStart(2,'0'),lines=parts.filter(p=>p.fecha===value);if(!cell)continue;cell.tabIndex=0;cell.setAttribute('role','button');cell.setAttribute('aria-label',value+': '+lines.length+' apuntes');if(lines.length)cell.classList.add(lines.every(p=>p.entregado)?'pc-day-sent':'pc-day-pending');const open=()=>{this.day=value;this.view='partes';this.render();};cell.addEventListener('click',open);cell.addEventListener('keydown',e=>{if(e.key==='Enter')open();});}
 }
 async command(accion,datos){if(!this.full?.acciones.includes(accion))throw new Error('Esta operación requiere actualizar los servicios del escritorio.');const requestId=this.submissionId;this.submissionId=undefined;return this.ctx.command(accion,datos,requestId);}
 documents(area,key,model,title,action){
  area.append(el('h2',title));let selected;
  const actions=[this.button('Nuevo',()=>this.editModel(model,null,body=>this.command(action,body),{title:'Nuevo · '+title})),this.button('Editar',()=>{if(!selected)throw new Error('Selecciona un documento.');if(key==='CambiosMaterial')throw new Error('Los movimientos aplicados se corrigen anulándolos y creando uno nuevo.');return this.editModel(model,selected,body=>this.command(action,body));}),this.button('Reutilizar',()=>{if(!selected)throw new Error('Selecciona un documento.');const copy=this.reuseDocument(key,selected);return this.editModel(model,copy,body=>this.command(action,body));})];
  if(key==='Partes')actions.push(this.button('Eliminar',async()=>{if(!selected)throw new Error('Selecciona un documento.');if(confirm('¿Eliminar el parte de obra '+selected.NumeroParte+'?'))await this.command('obra.eliminar',selected);}));
  if(key==='CambiosMaterial')actions.push(this.button('Anular movimiento',async()=>{if(!selected)throw new Error('Selecciona un movimiento.');if(confirm('¿Anular el movimiento y devolver sus existencias al origen?'))await this.command('cambio.anular',selected);}));
  if(key==='Necesidades')actions.push(this.button('Registrar recepción',()=>{if(!selected)throw new Error('Selecciona una hoja de necesidades.');return this.editModel(model,selected,body=>this.command(action,body),{title:'Recepción de materiales'});}));
  actions.push(this.button(key==='Necesidades'?'Exportar Word':'Exportar Excel',()=>this.exportDocument(key,selected,false)));
  if(key==='Partes')actions.push(this.button('Exportar PDF',()=>this.exportDocument(key,selected,true)));
  area.append(this.actions(...actions));const columns=key==='Partes'?['NumeroParte','Fecha','NumeroObra','Titulo','Cliente','Operarios','Materiales']:key==='Necesidades'?['Numero','FechaPedido','Obra','TituloObra','Estado','PorcentajeRecibido']:['Numero','Fecha','DescripcionCambio','Anulado','Materiales'];
  this.table(area,this.full.obra[key],columns,row=>selected=row);
 }
 async exportDocument(key,doc,pdf){
  if(!doc)throw new Error('Selecciona un documento.');const data={tipo:key==='Partes'?'obra':key==='Necesidades'?'necesidad':'cambio',id:doc.Id,version:doc.Version,formato:pdf?'PDF':'Excel'};
  if(key==='Partes'){
   const template=doc.PlantillaId||this.full.obra.Plantillas.find(p=>p.Activa)?.Id;if(!template)throw new Error('Incorpora una plantilla en Catálogos de obra antes de exportar.');
   return this.editFields([{nombre:'PlantillaId',tipo:'Int32'}],{PlantillaId:template},value=>{if(!value.PlantillaId)throw new Error('Selecciona la plantilla del documento.');return this.command('documento.exportar',{...data,plantilla:value.PlantillaId});},{title:'Exportar '+(pdf?'PDF':'Excel')+' · '+doc.NumeroParte});
  }
  await this.command('documento.exportar',data);
 }
 reuseDocument(key,selected){
  const copy=clone(selected);copy.Id=0;copy.Version=0;copy.Numero='';copy.NumeroParte='';copy.Creado='';copy.Modificado='';
  if(key==='Partes')copy.Fecha=this.ctx.today();
  if(key==='Necesidades'){copy.FechaPedido=this.ctx.today()+' '+new Date().toTimeString().slice(0,5);for(let n=1;n<=5;n++){copy['FechaRecepcion'+n]='';for(const material of copy.Materiales)material['Entrega'+n]='0';}}
  if(key==='CambiosMaterial'){copy.Fecha=this.ctx.today();copy.Anulado=false;for(const material of copy.Materiales){material.EnInventario=false;material.DescontadoOrigen='0';}}
  return copy;
 }
 catalog(area,name){
  const catalog=this.full.catalogos[name];area.append(el('h2',({obras:'N.º de obras',centros:'Centros de coste',tipos:'Tipos de hora',capitulos:'Capítulos de obra',clientes:'Clientes',jefes:'Jefes de obra',departamentos:'Departamentos'})[name]));let selected;
  const edit=(row)=>this.editFields(catalog.campos,row?.datos||{},data=>this.command('catalogo.guardar',{catalogo:name,clave:row?.datos[catalog.clave]??null,revision:row?.revision||'',fila:data}),{key:catalog.clave,existing:!!row});
  area.append(this.actions(this.button('Nuevo',()=>edit(null)),this.button('Editar',()=>{if(!selected)throw new Error('Selecciona una fila.');return edit(selected);}),this.button('Eliminar',async()=>{if(!selected)throw new Error('Selecciona una fila.');if(confirm('¿Eliminar el registro seleccionado?'))await this.command('catalogo.eliminar',{catalogo:name,clave:selected.datos[catalog.clave],revision:selected.revision,fila:{}});})));this.table(area,catalog.filas.map(r=>({...r.datos,_row:r})),catalog.campos.map(c=>c.nombre),row=>selected=row._row);
 }
 workCatalog(area,key){
  area.append(el('h2','Catálogos de obra'));area.append(this.actions(...['Clientes','Obras','Operarios','Equipos','Plantillas'].map(name=>this.button(name,()=>this.open('obra-catalogo:'+name)))));
  const model={Clientes:'ClienteObra',Obras:'ObraCatalogo',Operarios:'OperarioCatalogo',Equipos:'EquipoObra',Plantillas:'PlantillaObra'}[key];let selected;
  const save=item=>{const body=Object.fromEntries(['Revision','Clientes','Obras','Operarios','Equipos','Plantillas'].map(k=>[k,clone(this.full.obra[k])]));const index=body[key].findIndex(v=>v.Id===item.Id&&item.Id);if(index>=0)body[key][index]=item;else body[key].push(item);return this.command('catalogos-obra.guardar',body);};
  area.append(this.actions(this.button('Nuevo',()=>{if(key==='Plantillas')return this.upload(false);return this.editModel(model,null,save);}),this.button('Editar',()=>{if(!selected)throw new Error('Selecciona un registro.');return this.editModel(model,selected,save);}),this.button('Eliminar',async()=>{if(!selected)throw new Error('Selecciona un registro.');if(!confirm('¿Eliminar el registro del catálogo de obra?'))return;const body=Object.fromEntries(['Revision','Clientes','Obras','Operarios','Equipos','Plantillas'].map(k=>[k,clone(this.full.obra[k])]));body[key]=body[key].filter(v=>v.Id!==selected.Id);return this.command('catalogos-obra.guardar',body);})));const columns={Clientes:['Codigo','Nombre','Direccion','Contacto','Activo'],Obras:['Numero','Titulo','ClienteId','JefeObra','Activa'],Operarios:['Numero','Nombre','Apellidos','Activo'],Equipos:['Nombre','Descripcion','OperarioIds'],Plantillas:['Nombre','Activa','Archivo']}[key];this.table(area,this.full.obra[key],columns,row=>selected=row);
 }
 users(area){
  if(!this.admin)throw new Error('Esta vista requiere nivel Administrador.');area.append(el('h2','Usuarios'));let selected;
  area.append(this.actions(this.button('Crear usuario',()=>this.editFields([{nombre:'Numero',tipo:'Int16'},{nombre:'Nombre',tipo:'String',longitud:150},{nombre:'Contrasena',tipo:'Password',longitud:256},{nombre:'Administrador',tipo:'Boolean'}],{Numero:'',Nombre:'',Contrasena:'',Administrador:false},body=>this.command('usuario.crear',body),{title:'Crear cuenta de usuario'})),this.button('Retirar / reactivar acceso',async()=>{if(!selected)throw new Error('Selecciona una cuenta.');if(confirm((selected.Activo?'¿Retirar el acceso de ':'¿Reactivar a ')+selected.Numero+'?'))await this.command('usuario.acceso',{Numero:selected.Numero,Activo:!selected.Activo});}),this.button('Cambiar nivel',async()=>{if(!selected)throw new Error('Selecciona una cuenta.');if(confirm('¿Cambiar el nivel de '+selected.Numero+' a '+(selected.Administrador?'Operario':'Administrador')+'?'))await this.command('usuario.nivel',{Numero:selected.Numero,Administrador:!selected.Administrador});})));this.table(area,this.full.usuarios,['Numero','Nombre','Activo','Rol','Partes'],row=>selected=row);
 }
 statistics(area,byType){
  area.append(el('h2',byType?'Estadísticas · Mes y tipo de hora':'Estadísticas · Mes'));const rows=this.visibleParts(),groups=new Map();
  for(const row of rows){const key=byType?row.tipo_hora:row.fecha;const previous=groups.get(key)||0n;const raw=String(row.horas||'0'),sign=raw.startsWith('-')?-1n:1n,[a,b='']=raw.replace(/^-/, '').split('.');const units=sign*(BigInt(a||0)*10000000000n+BigInt((b+'0000000000').slice(0,10)));groups.set(key,previous+units);}
  const text=number=>{const sign=number<0n?'-':'',s=(number<0n?-number:number).toString().padStart(11,'0');return sign+(s.slice(0,-10)+'.'+s.slice(-10)).replace(/\.?0+$/,'');};
  this.table(area,[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>({Grupo:key,Horas:text(value)})),['Grupo','Horas']);area.append(this.actions(this.button('Exportar Excel',()=>this.exportDaily(rows)),this.button('Imprimir',()=>window.print())));
 }
 options(area){area.append(el('h2','Opciones'));const theme=el('select');for(const [value,name]of[['','Tema del PC'],['oscuro','Oscuro'],['claro','Claro']]){const option=el('option',name);option.value=value;theme.append(option);}theme.addEventListener('change',()=>document.documentElement.dataset.tema=theme.value||(/dark|black/i.test(this.state?.apariencia)?'oscuro':'claro'));const field=el('label','Apariencia');field.append(theme);area.append(field,this.note('Los cambios de apariencia de esta pantalla se aplican a esta sesión del móvil.'));}
 editModel(model,item,save,options={}){
  const schema=this.full.modelos[model];if(!schema)throw new Error('No se ha recibido el formulario de '+model+'.');
  const value=clone(item||schema.nuevo);
  if(!item){if(typeof value.Id==='string')value.Id=crypto.randomUUID().replace(/-/g,'');for(const name of Object.keys(value)){if(name.startsWith('Fecha')&&value[name])value[name]=name==='FechaPedido'?this.ctx.today()+' '+new Date().toTimeString().slice(0,5):this.ctx.today();}if('Anio' in value)value.Anio=Number($('month').value.slice(0,4));}
  let fields=schema.campos.filter(c=>!autoFields.has(c.nombre)&&!['Archivo','Pdf'].includes(c.nombre));
  if(['HojaNecesidades','CambioMaterialObra'].includes(model))fields=fields.filter(c=>c.nombre!=='Numero');
  this.editFields(fields,value,save,{...options,title:options.title||label(model),model});
 }
 editFields(fields,source,save,options={}){
  const dialog=this.modelDialog;dialog.replaceChildren();const form=el('form'),title=el('h2',options.title||'Datos del registro'),error=el('p',undefined,'error');error.setAttribute('role','alert');form.append(title);
  const read=this.fieldset(form,fields,clone(source),options);
  const cancel=this.button('Cancelar',()=>dialog.close()),submit=el('button','Guardar','primary');submit.type='submit';form.append(error,this.actions(cancel,submit));
  form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;error.textContent='';try{const value=read();this.submissionId=form.dataset.requestId||(form.dataset.requestId=crypto.randomUUID());await save(value);this.submissionId=undefined;dialog.close();this.open('sincronizacion');}catch(e){error.textContent=e.message;const previous=this.ctx.pending().find(item=>item.id===form.dataset.requestId);if(previous&&['rechazado','conflicto'].includes(previous.state))delete form.dataset.requestId;}finally{this.submissionId=undefined;submit.disabled=false;}});dialog.append(form);dialog.showModal();form.querySelector('input,select,textarea,button')?.focus();
 }
 fieldset(container,fields,value,options={}){
  const readers=[];
  for(const spec of fields){
   const name=spec.nombre,kind=spec.tipo,current=value[name];
   if(kind==='lista'){
    const box=el('fieldset',undefined,'pc-lines'),legend=el('legend',label(name));box.append(legend);container.append(box);
    if(spec.elemento==='Int32'){
     const select=el('select');select.multiple=true;select.size=6;
     for(const worker of this.full.obra.Operarios){const option=el('option',worker.Numero+' · '+[worker.Nombre,worker.Apellidos].filter(Boolean).join(' '));option.value=worker.Id;option.selected=(current||[]).includes(worker.Id);select.append(option);}box.append(select);readers.push(target=>target[name]=[...select.selectedOptions].map(o=>Number(o.value)));continue;
    }
    const rows=el('div'),collection=[],schema=this.full.modelos[spec.elemento];if(!schema)throw new Error('Falta la definición de las líneas de '+label(name)+'.');
    const add=item=>{const row=el('details',undefined,'pc-line-editor');row.open=true;const summary=el('summary',label(spec.elemento)+' · '+(collection.length+1));row.append(summary);const fields=schema.campos.filter(c=>!autoFields.has(c.nombre));const read=this.fieldset(row,fields,clone(item||schema.nuevo),{model:spec.elemento});const entry={row,read};collection.push(entry);row.append(this.button('Quitar línea',()=>{collection.splice(collection.indexOf(entry),1);row.remove();}));rows.append(row);};
    (current||[]).forEach(add);box.append(rows,this.button('Añadir línea',()=>add(null)));readers.push(target=>target[name]=collection.map(entry=>entry.read()));continue;
   }
   if(['NNulo','N','IdC','NumOperario','CentroCosteNulo','SubcentroNulo'].includes(name)&&options.model==='ParteApunte')continue;
   const field=el('label',name==='Contrasena'?'Contraseña':label(name));let input;
   const reference=({ClienteId:'Clientes',ObraId:'Obras',OperarioId:'Operarios',PlantillaId:'Plantillas'})[name];
   const choices=name==='Tipo'&&options.model==='DiaLaboral'?['Laborable','Festivo nacional','Festivo autonómico','Festivo local','Descanso por ajuste']:name==='Tipo'&&options.model==='AusenciaLaboral'?['Vacaciones','Asuntos propios']:null;
   if(choices||name==='TipoHora'){
    input=el('select');const values=choices||this.state.tipos_hora.map(row=>row.TipoHora);for(const entry of values){const option=el('option',choices?entry:entry+' · '+(this.state.tipos_hora.find(row=>row.TipoHora===entry)?.DescripcionHoras||''));option.value=entry;input.append(option);}if(current&&!values.includes(current)){const historic=el('option',current+' · registro histórico');historic.value=current;input.append(historic);}input.value=current||values[0]||'';
   }else if(name==='Operario'&&this.full.operarios){
    input=el('select');for(const worker of this.full.operarios){const option=el('option',worker.Numero+' · '+(worker.Nombre||''));option.value=worker.Numero;input.append(option);}input.value=String(current||this.worker||this.ctx.profile().operario);
   }else if(reference&&this.full.obra[reference]){ 
    input=el('select');const empty=el('option','Sin seleccionar');empty.value='0';input.append(empty);
    for(const row of this.full.obra[reference]){const option=el('option',[row.Numero,row.Nombre||row.Titulo].filter(Boolean).join(' · '));option.value=row.Id;input.append(option);}input.value=String(current||0);
    input.addEventListener('change',()=>{const row=this.full.obra[reference].find(r=>r.Id===Number(input.value));if(!row)return;const related=reference==='Obras'?{NumeroObra:row.Numero,Titulo:row.Titulo,JefeObra:row.JefeObra,DescripcionObra:row.Descripcion,ClienteId:row.ClienteId}:reference==='Operarios'?{Numero:row.Numero,Nombre:[row.Nombre,row.Apellidos].filter(Boolean).join(' ')}:reference==='Clientes'?{Cliente:row.Nombre}:{};for(const [key,text]of Object.entries(related)){const control=container.querySelector(`[data-field="${key}"]`);if(control)control.value=text??'';}});
   }else if(kind==='Boolean'){input=el('input');input.type='checkbox';input.checked=!!current;field.className='pc-check';}
   else if((/Descripcion|Observaciones|Notas|TrabajoEspecifico|MapeoJson/.test(name))&&name!=='OtroDptoNotas'){input=el('textarea');input.rows=3;input.value=current??'';}
   else{
    input=el('input');input.type=kind==='Password'?'password':['Desde','Hasta'].includes(name)?'time':kind==='DateTime'||name.startsWith('Fecha')?'date':'text';
    if(kind==='Password'){input.autocomplete='new-password';input.required=true;input.value='';}
    else if(input.type==='date')input.value=date(current);
    else input.value=current??'';
    if(['Int16','Int32','Decimal','Single','Double'].includes(kind))input.inputMode=kind.startsWith('Int')?'numeric':'decimal';
    if(kind==='DateTime')input.required=true;
   }
   input.dataset.field=name;
   if(spec.longitud>0)input.maxLength=spec.longitud;
   if(spec.automatico||spec.solo_lectura)input.disabled=true;
   field.append(input);container.append(field);
   readers.push(target=>{
    if(input.disabled)return;
    if(kind==='Boolean'){target[name]=input.checked;return;}
    let result=input.value;if(result===''&&spec.nulo){target[name]=null;return;}
    if(['Int16','Int32','Int64'].includes(kind)){if(!/^-?\d+$/.test(result))throw new Error('Indica un número entero en '+label(name)+'.');target[name]=Number(result);return;}
    if(['Decimal','Single','Double'].includes(kind)){result=result.replace(',','.');if(!/^-?\d+(\.\d+)?$/.test(result))throw new Error('Indica una cantidad válida en '+label(name)+'.');target[name]=result;return;}
    target[name]=kind==='DateTime'?result+'T00:00:00':result;
   });
  }
  return()=>{const target=clone(value);readers.forEach(read=>read(target));return target;};
 }
 laboral(area,key){
  area.append(el('h2','Calendario laboral y vacaciones'));const tabs={calendarios:'Calendarios',cupos:'Cupos por operario',ausencias:'Ausencias manuales',inicios:'Inicio del cómputo',ajustes:'Arrastres',saldos:'Saldos'};area.append(this.actions(...Object.entries(tabs).map(([name,text])=>this.button(text,()=>this.open('laboral:'+name)))));
  if(key==='saldos'){
   const year=Number($('month').value.slice(0,4)),rows=this.full.saldos.filter(r=>r.anio===year).map(r=>r.saldo);
   this.table(area,rows,['Operario','VacacionesCupo','VacacionesArrastre','VacacionesRegistradas','VacacionesSaldo','AsuntosCupo','AsuntosRegistrados','AsuntosSaldo']);return;
  }
  const config={calendarios:['Calendarios','AnualidadLaboral',['Anio','Vacaciones','AsuntosPropios','HorasJornada','Naturales']],cupos:['Cupos','CupoLaboral',['Operario','Anio','Vacaciones','AsuntosPropios']],ausencias:['Ausencias','AusenciaLaboral',['Operario','Fecha','Tipo','Dias','Nota']],inicios:['IniciosVacaciones','InicioVacacionesOperario',['Operario','AnioInicio','SaldoInicial']],ajustes:['AjustesArrastre','AjusteArrastreVacaciones',['Operario','Anio','Dias']]}[key];
  if(!config)return;const [property,model,columns]=config;let selected;
  const save=(value,index)=>this.saveLaboral(property,index>=0?this.full.laboral[property][index]:null,value,false);
  if(this.admin){const buttons=[this.button('Nuevo',()=>this.editModel(model,null,value=>save(value,-1))),this.button('Editar',()=>{if(!selected)throw new Error('Selecciona una fila.');return this.editModel(model,selected,value=>save(value,this.full.laboral[property].indexOf(selected)));}),this.button('Eliminar',async()=>{if(!selected)throw new Error('Selecciona una fila.');if(!confirm('¿Eliminar el registro del calendario laboral?'))return;return this.saveLaboral(property,selected,null,true);})];if(key==='calendarios')buttons.push(this.button('Importar PDF',()=>this.upload(true)));area.append(this.actions(...buttons));}
  this.table(area,this.full.laboral[property],columns,row=>selected=row);
 }
 saveLaboral(property,old,value,remove){
  const key=property==='Calendarios'?String(old?.Anio??''):property==='Ausencias'?old?.Id||'':property==='IniciosVacaciones'?String(old?.Operario??''):old?old.Operario+'|'+old.Anio:'';
  const revision=this.full.revisiones_laboral?.[property]?.find(row=>row.clave===key)?.revision||'';
  return this.command('calendario.registro',{coleccion:property,clave:key,revision,eliminar:remove,valor:value});
 }
 upload(pdf){
  const input=el('input');input.type='file';input.accept=pdf?'.pdf':'.xlsx';input.addEventListener('change',async()=>{try{const file=input.files[0];if(!file)return;if(file.size>5*1024*1024)throw new Error('El archivo admite hasta 5 MB.');const buffer=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<buffer.length;i+=32768)binary+=String.fromCharCode(...buffer.subarray(i,i+32768));const data={base64:btoa(binary)};if(pdf){data.anio=Number($('month').value.slice(0,4));await this.command('calendario.previsualizar',data);}else{data.nombre=prompt('Nombre de la plantilla',file.name.replace(/\.xlsx$/i,''));if(!data.nombre)return;await this.command('archivo.plantilla',data);}this.open('sincronizacion');}catch(error){this.ctx.error(error);}});input.click();
 }
 async openAdminDay(day,worker){if(!this.admin)throw new Error('Esta operación requiere nivel Administrador.');day=day||prompt('Fecha del parte (AAAA-MM-DD)',this.ctx.today());if(!day)return;await this.command('diario.abrir',{Operario:worker||this.worker||this.ctx.profile().operario,Fecha:day});this.open('sincronizacion');}
 openTeam(){
  if(!this.admin)throw new Error('Esta operación requiere nivel Administrador.');
  const dialog=this.modelDialog;dialog.replaceChildren();const form=el('form'),error=el('p',undefined,'error');error.setAttribute('role','alert');form.append(el('h2','Preparar partes de equipo'));
  const dateLabel=el('label','Fecha'),dateInput=el('input');dateInput.type='date';dateInput.value=this.ctx.today();dateInput.required=true;dateLabel.append(dateInput);form.append(dateLabel);
  const workers=el('fieldset');workers.append(el('legend','Operarios'));const checks=[];
  for(const person of this.full.operarios||[]){const labelNode=el('label',person.Numero+' · '+(person.Nombre||''),'pc-check'),input=el('input');input.type='checkbox';input.value=person.Numero;input.checked=person.Numero===this.worker;labelNode.prepend(input);workers.append(labelNode);checks.push(input);}form.append(workers,error);
  const submit=el('button','Abrir partes','primary');submit.type='submit';form.append(this.actions(this.button('Cancelar',()=>dialog.close()),submit));
  form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;try{const selected=checks.filter(input=>input.checked).map(input=>Number(input.value));if(!selected.length)throw new Error('Selecciona los operarios cuyos partes quieres preparar.');await this.command('equipo.abrir',{Fecha:dateInput.value,Operarios:selected});dialog.close();this.open('sincronizacion');}catch(e){error.textContent=e.message;}finally{submit.disabled=false;}});dialog.append(form);dialog.showModal();
 }
 adminDay(value){
  const dialog=this.modelDialog;dialog.replaceChildren();const form=el('form'),error=el('p',undefined,'error');error.setAttribute('role','alert');const team=Array.isArray(value.Dias),days=clone(team?value.Dias:[value]);form.append(el('h2',team?'Partes de equipo · '+days[0].Fecha:`Parte diario · ${value.Operario} · ${value.Fecha}`));
  const editors=[];
  for(const day of days){
   const group=el('fieldset'),area=el('div'),readers=[];group.append(el('legend','Operario '+day.Operario),area);form.append(group);
   const add=part=>{const fieldset=el('fieldset'),legend=el('legend','Línea del parte'),fields=[{nombre:'NumObra',tipo:'String',longitud:7},{nombre:'TituloObra',tipo:'String',longitud:255},{nombre:'NumHoras',tipo:'Decimal'},{nombre:'TipoHora',tipo:'String',longitud:2},{nombre:'km',tipo:'Decimal'},{nombre:'OtroDpto',tipo:'Boolean'},{nombre:'OtroDptoNotas',tipo:'String',longitud:20},{nombre:'Notas',tipo:'String',longitud:4000}];fieldset.append(legend);const base=this.fieldset(fieldset,fields,part),levels=[];for(let n=0;n<8;n++){const labelNode=el('label','N'+(n+1)),input=el('input');input.maxLength=4;input.value=part.N?.[n]??'';labelNode.append(input);fieldset.append(labelNode);levels.push(input);}const entry={read:()=>{const row=base();row.N=levels.map(i=>i.value||null);row.NNulo=levels.map(i=>!i.value);row.PendienteNumObra=!row.NumObra;return row;}};readers.push(entry);fieldset.append(this.button('Quitar línea',()=>{readers.splice(readers.indexOf(entry),1);fieldset.remove();}));area.append(fieldset);};
   day.Lineas.forEach(add);group.append(this.button('Añadir línea',()=>add({Id:-1,IdC:-1,NumOperario:day.Operario,NumObra:'',TituloObra:'',NumHoras:'8',TipoHora:this.state.tipos_hora[0]?.TipoHora||'',km:'0',OtroDpto:false,OtroDptoNotas:'',Notas:'',PendienteNumObra:true,Entregado:false,N:Array(8).fill(null),NNulo:Array(8).fill(true)})));
   editors.push({day,add,read:()=>({...day,Lineas:readers.map(e=>e.read())})});
  }
  if(team&&days.length>1)form.append(this.button('Copiar líneas del primero a los demás',()=>{try{const lines=editors[0].read().Lineas;for(const editor of editors.slice(1))for(const line of lines)editor.add({...clone(line),Id:-1,IdC:-1,NumOperario:editor.day.Operario,Entregado:false});}catch(e){error.textContent=e.message;}}));
  const submit=el('button',team?'Guardar equipo':'Guardar parte','primary');submit.type='submit';form.append(error,this.actions(this.button('Cancelar',()=>dialog.close()),submit));form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;try{const prepared=editors.map(editor=>editor.read());this.submissionId=form.dataset.requestId||(form.dataset.requestId=crypto.randomUUID());await this.command(team?'equipo.guardar':'diario.guardar',team?{Dias:prepared}:prepared[0]);dialog.close();this.open('sincronizacion');}catch(e){error.textContent=e.message;const previous=this.ctx.pending().find(item=>item.id===form.dataset.requestId);if(previous&&['rechazado','conflicto'].includes(previous.state))delete form.dataset.requestId;}finally{this.submissionId=undefined;submit.disabled=false;}});dialog.append(form);dialog.showModal();
 }
 renderPending(area){
  area.append(el('h2','Sincronización con el escritorio'),this.actions(this.button('Sincronizar ahora',()=>this.ctx.sync()),this.button('Conectar Dropbox',()=>$('reconnect').click())));
  const daily=this.state.sincronizacion_diarios;if(daily&&(daily.pendientes||daily.conflictos)){area.append(el('h3','Partes diarios pendientes de confirmar'),this.note(daily.pendientes+' pendientes · '+daily.conflictos+' requieren revisión'));this.table(area,daily.incidencias,['accion','estado','motivo']);}
  const rows=this.ctx.pending();if(!rows.length){if(!daily?.pendientes&&!daily?.conflictos)area.append(this.note('No hay envíos pendientes en este dispositivo.'));return;}
  for(const item of rows){const card=el('article',undefined,'pc-pending'),name=item.kind==='Comando'?label(item.comando?.accion||item.title||'Operación de escritorio'):(item.accion||'Crear')+' parte diario';card.append(el('h3',name),el('p',({pendiente:'Guardado · pendiente de enviar',enviado:'Enviado · esperando al escritorio',aplicado:'Guardado en el escritorio',conflicto:'Conflicto · necesita revisión',rechazado:'No se ha podido aplicar'})[item.state]||'Pendiente de confirmación'));if(item.reason)card.append(el('p',item.reason,'error'));
   const result=item.resultado;
   if(result?.base64)card.append(this.button('Descargar / compartir documento',()=>this.download(result)));
   if(result?.Dias)card.append(this.button('Abrir partes del equipo',()=>this.adminDay(result)));
   if(result?.HuellaInicial)card.append(this.button('Abrir parte diario',()=>this.adminDay(result)));
   if(result?.calendario)card.append(this.button('Revisar calendario antes de importar',()=>this.editModel('AnualidadLaboral',result.calendario,value=>this.saveLaboral('Calendarios',this.full.laboral.Calendarios.find(year=>year.Anio===value.Anio)||null,value,false))));
   if(['conflicto','rechazado'].includes(item.state)){if(item.comando?.datos)card.append(this.button('Revisar borrador',()=>this.reviewDraft(item)));card.append(this.button('Descartar este borrador',()=>this.ctx.discard(item)));}
   if(item.state==='aplicado')card.append(this.button('Retirar aviso',()=>this.ctx.discard(item)));
   area.append(card);
  }
 }
 reviewDraft(item){
  const draftData=clone(item.comando.datos);
  if(item.comando.accion==='catalogo.guardar'){
   const catalog=this.full.catalogos[draftData.catalogo],latest=catalog.filas.find(row=>String(row.datos[catalog.clave])===String(draftData.clave));
   return this.compareDraft(latest?.datos,draftData.fila,()=>this.editFields(catalog.campos,draftData.fila,value=>this.command('catalogo.guardar',{catalogo:draftData.catalogo,clave:latest?.datos[catalog.clave]??null,revision:latest?.revision||'',fila:value}),{title:'Revisar registro del catálogo'}));
  }
  if(item.comando.accion==='calendario.registro'&&!draftData.eliminar){
   const property=draftData.coleccion,model={Calendarios:'AnualidadLaboral',Cupos:'CupoLaboral',Ausencias:'AusenciaLaboral',IniciosVacaciones:'InicioVacacionesOperario',AjustesArrastre:'AjusteArrastreVacaciones'}[property];
   const key=row=>property==='Calendarios'?String(row.Anio):property==='Ausencias'?row.Id:property==='IniciosVacaciones'?String(row.Operario):row.Operario+'|'+row.Anio;
   const latest=this.full.laboral[property].find(row=>key(row)===draftData.clave);
   return this.compareDraft(latest,draftData.valor,()=>this.editModel(model,draftData.valor,value=>this.saveLaboral(property,latest,value,false),{title:'Revisar propuesta del calendario'}));
  }
  const action=item.comando.accion,model=({'obra.guardar':'DocumentoObra','necesidad.guardar':'HojaNecesidades','cambio.guardar':'CambioMaterialObra'})[action];
  if(!model)throw new Error('Abre de nuevo la pantalla de esta operación para revisar los datos actuales. El borrador original sigue conservado.');
  const draft=clone(item.comando.datos),collection=({'DocumentoObra':'Partes','HojaNecesidades':'Necesidades','CambioMaterialObra':'CambiosMaterial'})[model],latest=this.full.obra[collection].find(row=>row.Id===draft.Id);
  if(latest){
   const dialog=this.modelDialog;dialog.replaceChildren();dialog.append(el('h2','Revisar conflicto'),this.note('Compara los datos actuales del escritorio con tu propuesta. Abrir la propuesta no guarda ningún cambio.'));
   const describe=value=>Array.isArray(value)?value.map(row=>typeof row==='object'&&row!==null?Object.entries(row).filter(([k])=>!autoFields.has(k)).map(([k,v])=>label(k)+': '+String(v??'')).join(' · '):String(row)).join(' / '):String(value??'');
   const changes=Object.keys(draft).filter(key=>!autoFields.has(key)&&JSON.stringify(draft[key])!==JSON.stringify(latest[key])).map(key=>({Campo:label(key),Escritorio:describe(latest[key]),Propuesta:describe(draft[key])}));
   this.table(dialog,changes,['Campo','Escritorio','Propuesta']);
   dialog.append(this.actions(this.button('Conservar escritorio',async()=>{await this.ctx.discard(item);dialog.close();}),this.button('Abrir propuesta para revisar',()=>{draft.Version=latest.Version;dialog.close();this.editModel(model,draft,body=>this.command(action,body),{title:'Revisar propuesta · '+label(model)});})));dialog.showModal();return;
  }
  this.editModel(model,draft,body=>this.command(action,body),{title:'Revisar propuesta · '+label(model)});
 }
 compareDraft(latest,proposal,open){
  const dialog=this.modelDialog;dialog.replaceChildren();dialog.append(el('h2','Revisar propuesta'),this.note(latest?'Compara la versión actual del escritorio con tu borrador. Podrás revisarlo antes de guardar.':'El registro original ya no está disponible. Revisa el borrador antes de crear un registro nuevo.'));
  const describe=value=>value&&typeof value==='object'?JSON.stringify(value):String(value??'');
  this.table(dialog,Object.keys(proposal).filter(key=>!autoFields.has(key)).map(key=>({Campo:label(key),Escritorio:describe(latest?.[key]),Propuesta:describe(proposal[key])})),['Campo','Escritorio','Propuesta']);
  dialog.append(this.actions(this.button('Cerrar',()=>dialog.close()),this.button('Abrir borrador',()=>{dialog.close();open();})));dialog.showModal();
 }
 async download(result){
  const bytes=Uint8Array.from(atob(result.base64),c=>c.charCodeAt(0)),type=result.nombre.endsWith('.pdf')?'application/pdf':result.nombre.endsWith('.docx')?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',file=new File([bytes],result.nombre,{type});
  if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:result.nombre});return;}
  const url=URL.createObjectURL(file),a=el('a');a.href=url;a.download=result.nombre;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }
}

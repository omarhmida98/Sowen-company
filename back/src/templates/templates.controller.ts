import {Controller,Get} from '@nestjs/common';
@Controller('templates')export class TemplatesController{@Get()list(){return[
{id:'hotel',name:'Hôtel / ERP type O',buildingType:'ERP',erpType:'O',suggestedLots:['SSI','CFO / CFA','CVC','Cloisons','Menuiseries']},
{id:'erp',name:'ERP générique',buildingType:'ERP',suggestedLots:['SSI','CFO / CFA','Accessibilité','CVC']},
{id:'igh',name:'IGH',buildingType:'IGH',suggestedLots:['SSI','CFO / CFA','Désenfumage','CVC']},
{id:'office',name:'Bureaux',buildingType:'TERTIAIRE',suggestedLots:['CFO / CFA','CVC','Cloisons','Accessibilité']},
{id:'retail',name:'Commerce',buildingType:'ERP',erpType:'M',suggestedLots:['SSI','CFO / CFA','Accessibilité','Agencement']}
]}}

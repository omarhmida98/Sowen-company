'use client';import {Printer} from 'lucide-react';export function PrintButton(){return <button className="btn secondary" onClick={()=>window.print()}><Printer size={16}/>Imprimer / PDF</button>}

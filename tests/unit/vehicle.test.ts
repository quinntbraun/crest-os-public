import {it,expect} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {vehicleColumns,parseVehicle,draftFromVehicle} from '../../src/customer/vehicle-contract.ts';
import {vehicleVinHint} from '../../src/customer/customer-resource-contract.ts';
import {formatVehicleCsv} from '../../src/customer/vehicle-csv.ts';
import {vehicleFixture} from '../support/vehicle-fixture.ts';
import {customerBusiness,readCustomerCsv} from '../support/customer-fixture.ts';
const input=(rows=[vehicleFixture()])=>({businessId:customerBusiness,snapshotToken:'a'.repeat(64),expectedRowCount:String(rows.length),rows});
it('copies every22 source columns and permits label-only vehicles without inventing ownership/category',()=>{
 const value=vehicleFixture(),row=parseVehicle(value,customerBusiness);expect(Object.keys(row).sort()).toEqual([...vehicleColumns].sort());expect(Object.isFrozen(row)).toBe(true);expect(draftFromVehicle(row)).toMatchObject({label:'Synthetic vehicle',year:null,vin:null,kind:'customer_vehicle'});expect(row).not.toHaveProperty('customer_id');expect(row).not.toHaveProperty('category_id');
});
it.each([{label:''},{label:'\u00a0'},{make:'\u2000'},{archived_at:'2026-10-24T01:02:03.123456Z',archived_reason:'\ufeff'},{year:1.5},{year:2147483648},{vin_normalized:'forged'},{version:1},{version:'01'},{business_id:randomUUID()},{created_at:'invalid'},{archived_at:'invalid'},{private_secret:'reject'}])('rejects malformed source or unverified scope:%o',patch=>expect(()=>parseVehicle(vehicleFixture(patch as never),customerBusiness)).toThrow());
it.each([-2147483648,-500,0,1,2147483647])('retains unusual representable years without a current-year rule:%s',year=>expect(parseVehicle(vehicleFixture({year}),customerBusiness).year).toBe(year));
it('VIN normalization is a copied search hint, never identity or a global merge',()=>{
 const vin=' Raw-vin / é 001 ',row=parseVehicle(vehicleFixture({vin_raw:vin,vin_normalized:vehicleVinHint(vin)}),customerBusiness);expect(row.vin_raw).toBe(vin);expect(row.vin_normalized).toBe('RAWVIN001');expect(()=>parseVehicle({...row,vin_normalized:'RAWVIN002'},customerBusiness)).toThrow();
});
it('CSV round trips every typed source field, raw VIN/notes, null and exact audit timestamps/versions',()=>{
 const values=[null,'','\\N',"'raw",'=SUM(1,2)','\t+test','\n@formula','-raw','Synthetic "vehicle", é 😀'],rows=values.map((notes,i)=>vehicleFixture({id:'77777777-7777-4777-8777-'+String(i).padStart(12,'0'),notes,year:i%2===0?-500:null,vin_raw:'a-001',vin_normalized:'A001',version:'9007199254740993'})),out=formatVehicleCsv(input(rows)),matrix=readCustomerCsv(out.csv),header=matrix.shift()!,escapes=JSON.parse(out.escapeMap),slash=String.fromCharCode(92);
 const decoded=matrix.map(cells=>Object.fromEntries(header.map((column,i)=>{let value:string|number|null=cells[i]!;if(value===slash+'N')value=null;else{if(escapes.escapes.some((e:{row_id:string;column:string})=>e.row_id===cells[0]&&e.column===column))value=value.slice(1);value=value.replaceAll(slash+slash,slash);if(column==='year')value=Number(value);}return [column,value];})));expect(decoded).toEqual(rows);expect(header).toEqual(vehicleColumns);expect(JSON.parse(out.manifest)).toMatchObject({completeBackup:false,completeCrestExport:false,rowCount:String(rows.length)});
 for(const [name,content] of [['vehicles.csv',out.csv],['vehicle_escape_map.json',out.escapeMap],['vehicle_dictionary.json',out.dictionary]])expect(JSON.parse(out.manifest).parts.find((p:{name:string})=>p.name===name)).toMatchObject({bytes:Buffer.byteLength(content!),sha256:createHash('sha256').update(content!).digest('hex')});
});
it('refuses duplicate IDs, incomplete counts, wrong source fields and scopes without truncating',()=>{
 for(const value of [{...input(),expectedRowCount:'2'},input([vehicleFixture(),vehicleFixture()]),input([vehicleFixture({business_id:randomUUID()})]),input([vehicleFixture({private_secret:'bad'} as never)])])expect(()=>formatVehicleCsv(value)).toThrow();
});

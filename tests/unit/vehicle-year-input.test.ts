import {it,expect} from 'vitest';
import {vehicleYearInput} from '../../src/app/vehicles/year-input';
import {parseVehicleDraft} from '../../src/customer/customer-resource-contract';
import {emptyVehicleDraft} from '../../src/client/vehicle-editor-controller';

it.each(['-2147483648','-500','0','0000','2026','2147483647'])('accepts a whole PostgreSQL INTEGER year without a current-year restriction: %s',text=>expect(vehicleYearInput(text)).toBe(Number(text)));
it.each(['',' ','1.5','2e3','+2026','2026x','2147483648','-2147483649','1234567890123456'])('retains invalid year input as an unsaveable in-memory draft: %s',text=>{
  const year=vehicleYearInput(text);expect(Number.isNaN(year)).toBe(true);expect(()=>parseVehicleDraft({...emptyVehicleDraft,label:'Synthetic',year})).toThrow();
});

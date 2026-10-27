import {it,expect} from 'vitest';
import {phonePresentation} from '../../src/client/phone-presentation';
it.each([['2025550104','(202) 555-0104'],['12025550104','+1 (202) 555-0104'],['+1 202 555 0104 ext. 42','+1 (202) 555-0104 ext. 42'],['+44 20 7946 0958','+44 20 7946 0958'],[' Raw phone é /001 ',' Raw phone é /001 '],['123','123'],['+2025550104','+2025550104']])('presents %s without discarding unsupported or international input',(raw,shown)=>{expect(phonePresentation(raw)).toBe(shown);});

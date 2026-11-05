import {VehicleScreen} from './vehicles';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function VehiclesPage({searchParams}:{searchParams:Promise<{vehicle?:string|string[]}>}){const params=await searchParams;return <main className="customers"><p className="eyebrow">Crest Detailing</p><h1>Vehicles</h1><VehicleScreen initialVehicleId={typeof params.vehicle==='string'?params.vehicle:null}/></main>;}

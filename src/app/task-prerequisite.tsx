const tasks={
 booking:{title:'Start with accepted work',description:'Open an accepted quote to choose the work for this visit.',href:'/quotes',action:'Open saved quotes',steps:[['Choose the agreed work','Open the accepted quote and choose Book a visit.'],['Review the visit','Check vehicles, location and time before confirming.']]},
 work:{title:'Choose the job you are working on',description:'Open a saved visit in Schedule to record travel, arrival or work status.',href:'/schedule',action:'Open Schedule',steps:[['Open the saved visit','Choose the customer and appointment you need.'],['Record the next action','The job’s current state determines the available controls.']]},
 completion:{title:'Choose a job to finish',description:'Open the active visit in Schedule, then review and end the job.',href:'/schedule',action:'Open Schedule',steps:[['Review the visit','Check the accepted work and booked vehicles.'],['Record the actual outcome','Review completed and unfinished work before saving.']]},
 interruption:{title:'Open the trip you need to interrupt',description:'Choose an en-route Mobile job in Schedule, then open Interrupt this trip.',href:'/schedule',action:'Open Schedule',steps:[['Find the en-route visit','Open its saved job details.'],['Review the change','Record what happened before confirming the interruption.']]},
 cancellation:{title:'Choose the visit to review',description:'Open the saved job to check whether cancellation after starting work is available.',href:'/schedule',action:'Open Schedule',steps:[['Review the saved job','Its current work state determines which actions are available.'],['Review the consequences','Record the reason and confirm the eligible cancellation explicitly.']]},
 mileage:{title:'Choose a saved trip',description:'Open mileage from a saved job or a standalone trip to review its recorded distance.',href:'/schedule',action:'Open Schedule',steps:[['Open the trip in context','Choose the visit in Schedule, or open a saved standalone trip.'],['Review the evidence','Measured, entered and corrected distance remain distinct.']]},
 workTime:{title:'Open a job’s recorded time',description:'Choose a saved Mobile job in Schedule, then open Review recorded work time.',href:'/schedule',action:'Open Schedule',steps:[['Choose the saved visit','Open the job whose work intervals you want to review.'],['Review the ledger','See recorded active and paused time, history and available exports.']]},
} as const;

export function TaskPrerequisite({kind}:{kind:keyof typeof tasks}){
 const task=tasks[kind];
 return <section className="task-prerequisite" aria-label="Choose where to start">
  <div className="task-prerequisite-main"><h2>{task.title}</h2><p>{task.description}</p><a className="primary-action" href={task.href}>{task.action}<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" focusable="false"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></a>{kind==='mileage'&&<a className="task-prerequisite-alternate" href="/schedule/travel">Open standalone travel</a>}</div>
  <aside className="task-prerequisite-guide" aria-label="What happens next"><h3>What happens next</h3><ol>{task.steps.map(([title,detail])=><li key={title}><strong>{title}</strong><p>{detail}</p></li>)}</ol></aside>
 </section>;
}

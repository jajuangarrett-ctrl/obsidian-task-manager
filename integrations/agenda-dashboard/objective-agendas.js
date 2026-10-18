/* Objective Manager snapshot import. Source objectives are read-only; meeting progress stays in this browser. */
(function (root) {
  function personKey(name) { return String(name).trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
  function validate(snapshot) {
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.objectives)) throw new Error("Unsupported Objective Manager snapshot. Refresh Objective Manager, then select the agenda folder again.");
    snapshot.objectives.forEach(function (item) {
      if (!item || typeof item.id !== "string" || !item.id || typeof item.title !== "string" || !Array.isArray(item.people) || item.people.some(function(name){return typeof name !== "string";})) throw new Error("Invalid Objective Manager snapshot. The previous agenda has been kept.");
    });
    return snapshot;
  }
  function merge(roster, snapshot) {
    validate(snapshot);
    var result = roster.map(function(member){return Object.assign({},member,{tasks:member.tasks.filter(function(task){return task.source !== "objective";})});});
    var people = new Map(result.map(function(member){return [personKey(member.name),member];}));
    snapshot.objectives.forEach(function(objective){
      if (objective.status === "completed" || objective.status === "archived") return;
      objective.people.forEach(function(name){
        var key=personKey(name); if(!key) return;
        var member=people.get(key);
        if (!member) {member={name:name.trim(),kind:"Person",fileName:name.trim()+".md",modified:"",shortHash:"",tasks:[]};people.set(key,member);result.push(member);}
        var taskKey="objective-"+objective.id+"-"+encodeURIComponent(key);
        if(member.tasks.some(function(task){return task.key===taskKey;})) return;
        member.tasks.push({key:taskKey,title:objective.title,priority:objective.priority==="high"?"High impact":"",category:"Objectives",source:"objective",objectiveId:objective.id,status:objective.status,due:objective.due||"",path:objective.path||"",vault:snapshot.vault||"",sourceIndex:member.tasks.length});
      });
    });
    return result;
  }
  root.FJGObjectiveAgendas={validate:validate,merge:merge};
})(typeof window !== "undefined" ? window : globalThis);

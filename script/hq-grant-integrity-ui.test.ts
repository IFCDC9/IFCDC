import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../client/src/auth/AuthContext";
import { GrantOpportunityFinderPanel, GrantIntelligencePanel } from "../client/src/components/hq/grants/GrantCenterEnterprisePanels";

test("actual Founder UI disables an expired Finder result and renders organization matches", async () => {
  const dom = new JSDOM('<div id="root"></div>',{url:"https://hq.test/hq/grants"});
  for (const [key,value] of Object.entries({window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})) Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    assert.match(String(input),/\/api\/hq\/auth\/session/);
    return Response.json({user:{id:"founder",email:"service@ifcdc.org",role:"owner",permissions:[]}});
  }) as typeof fetch;
  const client = new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity,gcTime:Infinity},mutations:{retry:false}}});
  client.setQueryData(["grant-opportunity-finder","",""],{opportunities:[{id:"expired",title:"Expired grant",funder:"Example",status:"open",deadline:"2024-04-24"},{id:"future",title:"Future grant",funder:"Example",status:"open",deadline:"2099-01-01"}],categorized:{}});
  client.setQueryData(["grant-intelligence-dashboard"],{programs:[],liveFeed:[]});
  client.setQueryData(["grant-org-matches","fit",""],{matches:[{opportunityId:"match",title:"Expired match",funder:"Example",bestProgram:{slug:"youth",label:"Youth",score:70},eligibility:{grade:"B"},fundingAmount:{min:0,max:50000},deadline:"2024-04-24",matchScore:70,priority:"medium",recommendedNextStep:"Review"}],programs:[]});
  client.setQueryData(["grant-program-queues",""],{programs:[]});
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await React.act(async()=>{root.render(React.createElement(QueryClientProvider,{client},React.createElement(MemoryRouter,null,React.createElement(AuthProvider,null,React.createElement(React.Fragment,null,React.createElement(GrantOpportunityFinderPanel),React.createElement(GrantIntelligencePanel))))));});
    await React.act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
    const row = (title:string)=>[...document.querySelectorAll("tr")].find(r=>r.textContent?.includes(title))!;
    assert.ok(row("Expired grant").querySelector<HTMLButtonElement>('button[title*="Deadline has passed"]')?.disabled);
    assert.equal([...row("Future grant").querySelectorAll("button")].find(b=>b.textContent?.includes("Start Application"))?.disabled,false);
    assert.ok(row("Expired match").querySelector<HTMLButtonElement>('button[title*="Deadline has passed"]')?.disabled);
  } finally {
    await React.act(async()=>root.unmount());client.clear();dom.window.close();globalThis.fetch=originalFetch;
  }
});

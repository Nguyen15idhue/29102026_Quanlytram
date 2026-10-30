package relay

import "testing"

func TestEndpointKeyNormalizes(t *testing.T) {
	key := EndpointKey(EndpointConfig{Host: " CASTER.Example.COM ", Port: 2101, Mount: "/MOUNT/"})
	if key != "http://caster.example.com:2101/MOUNT" {
		t.Fatalf("key = %q", key)
	}
	secure := EndpointKey(EndpointConfig{Host: "h", Mount: "m", SSL: true})
	if secure != "https://h:443/m" {
		t.Fatalf("secure key = %q", secure)
	}
}

func TestJobHasCycle(t *testing.T) {
	a := Edge{JobID: 1, UpstreamKey: "a", DownstreamKey: "b"}
	b := Edge{JobID: 2, UpstreamKey: "b", DownstreamKey: "a"}
	if !JobHasCycle(a, []Edge{a, b}) {
		t.Fatal("expected a to participate in a cycle")
	}
	plain := Edge{JobID: 3, UpstreamKey: "c", DownstreamKey: "d"}
	if JobHasCycle(plain, []Edge{a, b, plain}) {
		t.Fatal("expected plain edge to be acyclic")
	}
	self := Edge{JobID: 4, UpstreamKey: "self", DownstreamKey: "self"}
	if !JobHasCycle(self, []Edge{self}) {
		t.Fatal("expected self loop")
	}
}

func TestFindCycle(t *testing.T) {
	if cycle := FindCycle([]Edge{
		{UpstreamKey: "a", DownstreamKey: "b"},
		{UpstreamKey: "b", DownstreamKey: "c"},
		{UpstreamKey: "c", DownstreamKey: "a"},
	}); cycle == nil {
		t.Fatal("expected a cycle")
	}
	if cycle := FindCycle([]Edge{
		{UpstreamKey: "a", DownstreamKey: "b"},
		{UpstreamKey: "a", DownstreamKey: "c"},
	}); cycle != nil {
		t.Fatalf("unexpected cycle: %v", cycle)
	}
}

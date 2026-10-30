package relay

func buildAdjacency(edges []Edge) map[string][]string {
	adjacency := make(map[string][]string)
	for _, edge := range edges {
		adjacency[edge.UpstreamKey] = append(adjacency[edge.UpstreamKey], edge.DownstreamKey)
	}
	return adjacency
}

func reachable(adjacency map[string][]string, from, target string) bool {
	visited := make(map[string]bool)
	stack := []string{from}
	for len(stack) > 0 {
		node := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if node == target {
			return true
		}
		if visited[node] {
			continue
		}
		visited[node] = true
		stack = append(stack, adjacency[node]...)
	}
	return false
}

func JobHasCycle(job Edge, all []Edge) bool {
	if job.UpstreamKey == job.DownstreamKey {
		return true
	}
	adjacency := buildAdjacency(all)
	return reachable(adjacency, job.DownstreamKey, job.UpstreamKey)
}

func FindCycle(edges []Edge) []string {
	adjacency := buildAdjacency(edges)
	visiting := make(map[string]bool)
	visited := make(map[string]bool)
	var stack []string

	var walk func(string) []string
	walk = func(node string) []string {
		if visiting[node] {
			for i, item := range stack {
				if item == node {
					return append(append([]string{}, stack[i:]...), node)
				}
			}
			return []string{node, node}
		}
		if visited[node] {
			return nil
		}
		visiting[node] = true
		stack = append(stack, node)
		for _, next := range adjacency[node] {
			if cycle := walk(next); cycle != nil {
				return cycle
			}
		}
		stack = stack[:len(stack)-1]
		delete(visiting, node)
		visited[node] = true
		return nil
	}

	for node := range adjacency {
		if cycle := walk(node); cycle != nil {
			return cycle
		}
	}
	return nil
}

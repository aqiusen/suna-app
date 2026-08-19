package bridge

import (
	"context"
	"testing"
	"time"
)

func TestEmptyIdleFiresAfterLastClientLeaves(t *testing.T) {
	service, err := New(fakeConnector{connection: newFakeConnection()}, Config{})
	if err != nil {
		t.Fatal(err)
	}
	fired := make(chan struct{}, 1)
	service.SetEmptyIdle(20*time.Millisecond, func() {
		select {
		case fired <- struct{}{}:
		default:
		}
	})

	id, _, err := service.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-fired:
		t.Fatal("empty idle fired while a client was connected")
	case <-time.After(40 * time.Millisecond):
	}

	if err := service.Disconnect(id); err != nil {
		t.Fatal(err)
	}
	select {
	case <-fired:
	case <-time.After(time.Second):
		t.Fatal("empty idle did not fire after last client left")
	}
}

func TestEmptyIdleDoesNotFireBeforeFirstClient(t *testing.T) {
	service, err := New(fakeConnector{connection: newFakeConnection()}, Config{})
	if err != nil {
		t.Fatal(err)
	}
	fired := make(chan struct{}, 1)
	service.SetEmptyIdle(20*time.Millisecond, func() {
		fired <- struct{}{}
	})
	select {
	case <-fired:
		t.Fatal("empty idle fired before any client connected")
	case <-time.After(50 * time.Millisecond):
	}
}

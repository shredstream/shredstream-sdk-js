#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::{Buffer, Result};
use napi::{Error, Status};
use shredstream as ss;


#[napi(object)]
#[derive(Default)]
pub struct AccumulatorConfig {
    pub max_fec_sets_per_slot: Option<u32>,
    pub stuck_batch_timeout_ms: Option<u32>,
}

#[napi(object)]
#[derive(Default)]
pub struct ListenerOptions {
    pub recv_buf: Option<u32>,
    pub max_age: Option<BigInt>,
    pub busy_poll_us: Option<u32>,
    pub disable_busy_poll: Option<bool>,
    pub pool_size: Option<u32>,
    pub enable_fec: Option<bool>,
    pub disable_salvage_delivery: Option<bool>,
    pub accumulator: Option<AccumulatorConfig>,
}

use napi::bindgen_prelude::BigInt;

fn to_rust_options(o: ListenerOptions) -> ss::ListenerOptions {
    let mut out = ss::ListenerOptions::default();
    if let Some(v) = o.recv_buf {
        out.recv_buf = v as usize;
    }
    if let Some(v) = o.max_age {
        out.max_age = v.get_u64().1;
    }
    if matches!(o.disable_busy_poll, Some(true)) {
        out.busy_poll_us = None;
    } else if let Some(v) = o.busy_poll_us {
        out.busy_poll_us = Some(v);
    }
    if let Some(v) = o.pool_size {
        out.pool_size = v as usize;
    }
    if let Some(v) = o.enable_fec {
        out.enable_fec = v;
    }
    if let Some(v) = o.disable_salvage_delivery {
        out.disable_salvage_delivery = v;
    }
    if let Some(a) = o.accumulator {
        if let Some(m) = a.max_fec_sets_per_slot {
            out.accumulator.max_fec_sets_per_slot = m as usize;
        }
        if let Some(ms) = a.stuck_batch_timeout_ms {
            out.accumulator.stuck_batch_timeout = std::time::Duration::from_millis(ms as u64);
        }
    }
    out
}


#[napi(string_enum)]
pub enum VariantKind {
    DataLegacy,
    CodeLegacy,
    DataMerkleUnchained,
    DataMerkleResigned,
    CodeMerkleUnchained,
    CodeMerkleResigned,
}

#[napi]
pub fn classify_variant(byte: u32) -> Option<VariantKind> {
    let b = (byte & 0xFF) as u8;
    ss::classify_variant(b).map(|v| match v {
        ss::VariantKind::DataLegacy => VariantKind::DataLegacy,
        ss::VariantKind::CodeLegacy => VariantKind::CodeLegacy,
        ss::VariantKind::DataMerkle { resigned: false, .. } => VariantKind::DataMerkleUnchained,
        ss::VariantKind::DataMerkle { resigned: true, .. } => VariantKind::DataMerkleResigned,
        ss::VariantKind::CodeMerkle { resigned: false, .. } => VariantKind::CodeMerkleUnchained,
        ss::VariantKind::CodeMerkle { resigned: true, .. } => VariantKind::CodeMerkleResigned,
    })
}

#[napi]
pub fn variant_proof_size(byte: u32) -> u32 {
    let b = (byte & 0xFF) as u8;
    ss::classify_variant(b).map(|v| v.proof_size() as u32).unwrap_or(0)
}

#[napi]
pub fn variant_resigned(byte: u32) -> bool {
    let b = (byte & 0xFF) as u8;
    ss::classify_variant(b).map(|v| v.resigned()).unwrap_or(false)
}

#[napi]
pub fn variant_merkle_suffix(byte: u32) -> u32 {
    let b = (byte & 0xFF) as u8;
    ss::classify_variant(b)
        .map(|v| v.merkle_suffix() as u32)
        .unwrap_or(0)
}


#[napi]
pub fn pin_current_thread_to_cpu(cpu_id: u32) -> Result<()> {
    ss::pin_current_thread_to_cpu(cpu_id as usize)
        .map_err(|e| Error::new(Status::GenericFailure, format!("pin failed: {e}")))
}


#[napi(object)]
pub struct TransactionBatch {
    pub slot: BigInt,
    pub transactions: Vec<Buffer>,
}

#[napi(object)]
pub struct RawShred {
    pub slot: BigInt,
    pub index: u32,
    pub payload_len: u32,
}


type Inner = Arc<Mutex<Option<ss::ShredListener>>>;

#[napi]
pub struct ShredListener {
    inner: Inner,
}

fn serialize_txs(txs: Vec<solana_transaction::versioned::VersionedTransaction>) -> Vec<Buffer> {
    let mut out = Vec::with_capacity(txs.len());
    for tx in txs {
        match bincode::serialize(&tx) {
            Ok(bytes) => out.push(Buffer::from(bytes)),
            Err(_) => continue,
        }
    }
    out
}

#[napi]
impl ShredListener {
    #[napi(factory)]
    pub fn bind(port: u32) -> Result<ShredListener> {
        let l = ss::ShredListener::bind(port as u16)
            .map_err(|e| Error::new(Status::GenericFailure, format!("bind failed: {e}")))?;
        Ok(ShredListener {
            inner: Arc::new(Mutex::new(Some(l))),
        })
    }

    #[napi(factory, js_name = "bindWithOptions")]
    pub fn bind_with_options(port: u32, opts: ListenerOptions) -> Result<ShredListener> {
        let ropts = to_rust_options(opts);
        let l = ss::ShredListener::bind_with_options(port as u16, ropts)
            .map_err(|e| Error::new(Status::GenericFailure, format!("bind failed: {e}")))?;
        Ok(ShredListener {
            inner: Arc::new(Mutex::new(Some(l))),
        })
    }

    #[napi(factory)]
    pub fn offline() -> Result<ShredListener> {
        let l = ss::ShredListener::bind(0)
            .map_err(|e| Error::new(Status::GenericFailure, format!("bind failed: {e}")))?;
        Ok(ShredListener {
            inner: Arc::new(Mutex::new(Some(l))),
        })
    }

    #[napi]
    pub fn next_transaction_sync(&self) -> Result<Option<TransactionBatch>> {
        let mut guard = match self.inner.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let listener = match guard.as_mut() {
            Some(l) => l,
            None => return Ok(None),
        };
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let next = listener.transactions().next();
            next.map(|(slot, txs)| {
                let serialized: Vec<Vec<u8>> =
                    txs.iter().filter_map(|t| bincode::serialize(t).ok()).collect();
                (slot, serialized)
            })
        }));
        match outcome {
            Ok(Some((slot, raw_txs))) => Ok(Some(TransactionBatch {
                slot: BigInt::from(slot),
                transactions: raw_txs.into_iter().map(Buffer::from).collect(),
            })),
            Ok(None) => Ok(None),
            Err(_) => Err(Error::new(
                Status::Unknown,
                "RUST_PANIC: nextTransactionSync".to_string(),
            )),
        }
    }

    #[napi]
    pub async fn next_transaction(&self) -> Result<Option<TransactionBatch>> {
        let inner = self.inner.clone();
        let res: Result<Option<(u64, Vec<Vec<u8>>)>> = napi::tokio::task::block_in_place(|| {
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let mut guard = match inner.lock() {
                    Ok(g) => g,
                    Err(p) => p.into_inner(),
                };
                let listener = match guard.as_mut() {
                    Some(l) => l,
                    None => return Ok::<_, Error>(None),
                };
                let next = listener.transactions().next();
                Ok(next.map(|(slot, txs)| {
                    let serialized: Vec<Vec<u8>> =
                        txs.iter().filter_map(|t| bincode::serialize(t).ok()).collect();
                    (slot, serialized)
                }))
            }));
            match outcome {
                Ok(r) => r,
                Err(_) => Err(Error::new(
                    Status::Unknown,
                    "RUST_PANIC: nextTransaction".to_string(),
                )),
            }
        });
        Ok(res?.map(|(slot, raw_txs)| TransactionBatch {
            slot: BigInt::from(slot),
            transactions: raw_txs.into_iter().map(Buffer::from).collect(),
        }))
    }

    #[napi]
    pub async fn next_shred(&self) -> Result<Option<RawShred>> {
        let inner = self.inner.clone();
        let res: Result<Option<(u64, u32, usize)>> = napi::tokio::task::block_in_place(|| {
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let mut guard = match inner.lock() {
                    Ok(g) => g,
                    Err(p) => p.into_inner(),
                };
                let listener = match guard.as_mut() {
                    Some(l) => l,
                    None => return Ok::<_, Error>(None),
                };
                let next = listener.shreds().next();
                Ok(next.map(|s| (s.slot, s.index, s.payload_len)))
            }));
            match outcome {
                Ok(r) => r,
                Err(_) => Err(Error::new(
                    Status::Unknown,
                    "RUST_PANIC: nextShred".to_string(),
                )),
            }
        });
        Ok(res?.map(|(slot, index, payload_len)| RawShred {
            slot: BigInt::from(slot),
            index,
            payload_len: payload_len.min(u32::MAX as usize) as u32,
        }))
    }

    #[napi]
    pub fn handle_packet(&self, data: Buffer) -> Result<Option<TransactionBatch>> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| Error::new(Status::GenericFailure, "listener mutex poisoned"))?;
        let listener = match guard.as_mut() {
            Some(l) => l,
            None => return Ok(None),
        };
        let bytes: &[u8] = data.as_ref();
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            listener.handle_packet(bytes)
        }))
        .map_err(|_| Error::new(Status::Unknown, "RUST_PANIC: panic in handle_packet"))?;
        Ok(res.map(|(slot, txs)| TransactionBatch {
            slot: BigInt::from(slot),
            transactions: serialize_txs(txs),
        }))
    }

    #[napi]
    pub fn close(&self) {
        if let Ok(mut g) = self.inner.lock() {
            let _ = g.take();
        }
    }


    fn with_listener<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&ss::ShredListener) -> R,
        R: Default,
    {
        let guard = match self.inner.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        match guard.as_ref() {
            Some(l) => f(l),
            None => R::default(),
        }
    }

    #[napi(getter)]
    pub fn slot_count(&self) -> u32 {
        self.with_listener(|l| l.slot_count().min(u32::MAX as usize) as u32)
    }
    #[napi(getter)]
    pub fn pool_exhausted_count(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.pool_exhausted_count()))
    }
    #[napi(getter)]
    pub fn busy_poll_active(&self) -> bool {
        self.with_listener(|l| l.busy_poll_active())
    }
    #[napi(getter)]
    pub fn last_io_error_kind(&self) -> Option<String> {
        let guard = match self.inner.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        guard
            .as_ref()
            .and_then(|l| l.last_io_error_kind().map(|k| format!("{k:?}")))
    }
    #[napi(getter)]
    pub fn data_shred_count_total(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.data_shred_count_total()))
    }
    #[napi(getter)]
    pub fn code_shred_count_total(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.code_shred_count_total()))
    }
    #[napi(getter)]
    pub fn bytes_received(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.bytes_received()))
    }
    #[napi(getter)]
    pub fn unparseable_packets(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.unparseable_packets()))
    }
    #[napi(getter)]
    pub fn unparseable_too_short(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.unparseable_too_short()))
    }
    #[napi(getter)]
    pub fn unparseable_variant(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.unparseable_variant()))
    }
    #[napi(getter)]
    pub fn unparseable_payload(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.unparseable_payload()))
    }
    #[napi(getter)]
    pub fn unparseable_slot_range(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.unparseable_slot_range()))
    }
    #[napi(getter)]
    pub fn dropped_known_slots(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.dropped_known_slots()))
    }
    #[napi(getter)]
    pub fn harvested_batches_total(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.harvested_batches_total()))
    }
    #[napi(getter)]
    pub fn decode_errors_total(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.decode_errors_total()))
    }
    #[napi(getter)]
    pub fn fec_recoveries_total(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.fec_recoveries_total()))
    }
    #[napi(getter)]
    pub fn fec_recovery_failures_total(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.fec_recovery_failures_total()))
    }
    #[napi(getter)]
    pub fn batches_skipped_total(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.batches_skipped_total()))
    }
    #[napi(getter)]
    pub fn batches_decoded_streaming_total(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.batches_decoded_streaming_total()))
    }
    #[napi(getter)]
    pub fn batches_decoded_fallback_total(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.batches_decoded_fallback_total()))
    }
    #[napi(getter)]
    pub fn slots_completed_total(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.slots_completed_total()))
    }
    #[napi(getter)]
    pub fn slots_evicted_by_age(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.slots_evicted_by_age()))
    }
    #[napi(getter)]
    pub fn salvaged_tail_tx_total(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.salvaged_tail_tx_total()))
    }
    #[napi(getter)]
    pub fn fec_sets_discarded_unused_total(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.fec_sets_discarded_unused_total()))
    }
    #[napi(getter)]
    pub fn fec_sets_evicted_early_total(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.fec_sets_evicted_early_total()))
    }
    #[napi(getter)]
    pub fn batches_force_finalized_corrupted_total(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.batches_force_finalized_corrupted_total()))
    }
    #[napi(getter)]
    pub fn batches_force_finalized_timeout_total(&self) -> BigInt {
        BigInt::from(self.with_listener(|l| l.batches_force_finalized_timeout_total()))
    }
    #[napi(getter)]
    pub fn local_address(&self) -> Option<String> {
        let guard = match self.inner.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        guard
            .as_ref()
            .and_then(|l| l.local_addr().ok().map(|a| a.to_string()))
    }
}

#[cfg(unix)]
#[napi]
impl ShredListener {
    #[napi(factory, js_name = "fromFd")]
    pub fn from_fd(fd: i32, opts: ListenerOptions) -> Result<ShredListener> {
        use std::os::unix::io::FromRawFd;
        let std_socket = unsafe { std::net::UdpSocket::from_raw_fd(fd) };
        let ropts = to_rust_options(opts);
        let l = ss::ShredListener::from_socket(std_socket, ropts)
            .map_err(|e| Error::new(Status::GenericFailure, format!("from_socket failed: {e}")))?;
        Ok(ShredListener {
            inner: Arc::new(Mutex::new(Some(l))),
        })
    }
}
